use std::{
    io::{ErrorKind, Read, Write},
    net::TcpListener,
    process::Command,
    thread,
};

use tuneflow_source_runtime_prototype::{ResolveInput, ResolvedUrl, resolve_music_url, summarize};

fn fixture_source(request_url: &str) -> String {
    format!(
        r#"
const {{ EVENT_NAMES, on, send, request }} = globalThis.lx;
on(EVENT_NAMES.request, ({{ action }}) => new Promise((resolve, reject) => {{
  if (action !== 'musicUrl') return reject(new Error('unexpected action'));
  request({request_url:?}, {{ method: 'GET' }}, (error, response) => {{
    if (error) reject(error); else resolve(response.body.url);
  }});
}}));
send(EVENT_NAMES.inited, {{
  sources: {{ fixture: {{ type: 'music', actions: ['musicUrl'], qualitys: ['128k'] }} }},
}});
"#
    )
}

fn async_initialization_source(request_url: &str) -> String {
    format!(
        r#"
const {{ EVENT_NAMES, on, send, request }} = globalThis.lx;
on(EVENT_NAMES.request, ({{ action }}) => {{
  if (action !== 'musicUrl') throw new Error('unexpected action');
  return 'https://media.example.test/initialized.flac';
}});
request({request_url:?}, {{ method: 'GET' }}, error => {{
  if (error) throw error;
  send(EVENT_NAMES.inited, {{
    sources: {{ fixture: {{ type: 'music', actions: ['musicUrl'], qualitys: ['128k'] }} }},
  }});
}});
"#
    )
}

fn serve_once(body: &'static str) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 4096];
        let size = stream.read(&mut request).unwrap();
        assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /resolve HTTP/1.1"));
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    (origin, handle)
}

#[test]
fn resolves_a_music_url_through_the_json_network_bridge() {
    let (origin, server) = serve_once(r#"{"url":"https://media.example.test/audio.flac"}"#);
    let script = fixture_source(&format!("{origin}/resolve"));

    let resolved = resolve_music_url(ResolveInput {
        script: &script,
        source: "fixture",
        track_id: "fixture-track",
        quality: "128k",
        allowed_origin: &origin,
        allow_http_loopback: true,
    })
    .unwrap();

    assert_eq!(
        resolved.url().as_str(),
        "https://media.example.test/audio.flac"
    );
    server.join().unwrap();
}

#[test]
fn waits_for_a_network_backed_source_initialization_before_invoking_it() {
    let (origin, server) = serve_once(r#"{}"#);
    let script = async_initialization_source(&format!("{origin}/resolve"));

    let resolved = resolve_music_url(ResolveInput {
        script: &script,
        source: "fixture",
        track_id: "fixture-track",
        quality: "128k",
        allowed_origin: &origin,
        allow_http_loopback: true,
    })
    .unwrap();

    assert_eq!(
        resolved.url().as_str(),
        "https://media.example.test/initialized.flac"
    );
    server.join().unwrap();
}

#[test]
fn rejects_a_source_request_outside_the_allowed_origin() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let request_url = format!("http://{}/resolve", listener.local_addr().unwrap());
    let script = fixture_source(&request_url);

    let result = resolve_music_url(ResolveInput {
        script: &script,
        source: "fixture",
        track_id: "fixture-track",
        quality: "128k",
        allowed_origin: "https://allowed.example",
        allow_http_loopback: true,
    });
    let error = match result {
        Ok(_) => panic!("disallowed origin unexpectedly resolved"),
        Err(error) => error,
    };

    assert_eq!(error.to_string(), "source network request failed");
    assert!(!error.to_string().contains("127.0.0.1"));
    assert_eq!(listener.accept().unwrap_err().kind(), ErrorKind::WouldBlock);
}

#[test]
fn redacts_the_complete_playback_url() {
    let resolved =
        ResolvedUrl::for_test("https://media.example.test/secret/audio.flac?token=never-log");
    let rendered = summarize(&resolved).to_string();

    assert!(rendered.contains("resolved=true"));
    assert!(rendered.contains("scheme=https"));
    assert!(rendered.contains("host=media.example.test"));
    assert!(rendered.contains("length="));
    assert!(rendered.contains("sha256="));
    assert!(!rendered.contains("secret"));
    assert!(!rendered.contains("token"));
    assert!(!rendered.contains("never-log"));
}

#[test]
fn rejects_missing_cli_arguments() {
    let output = Command::new(env!("CARGO_BIN_EXE_tuneflow-source-runtime-prototype"))
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "usage: tuneflow-source-runtime-prototype --script <path> --source <id> --track-id <id> --quality <quality> --allow-origin <origin>"
    );
}

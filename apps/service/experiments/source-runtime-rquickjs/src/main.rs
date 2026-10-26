use std::{collections::BTreeMap, env, ffi::OsString, fs, path::PathBuf, process::ExitCode};

use tuneflow_source_runtime_prototype::{ResolveInput, resolve_music_url, summarize};

const USAGE: &str = "usage: tuneflow-source-runtime-prototype --script <path> --source <id> --track-id <id> --quality <quality> --allow-origin <origin>";
const FLAGS: [&str; 5] = [
    "--script",
    "--source",
    "--track-id",
    "--quality",
    "--allow-origin",
];

enum CliError {
    Usage,
    Runtime(&'static str),
}

fn parse_args() -> Result<BTreeMap<String, OsString>, CliError> {
    let mut arguments = env::args_os().skip(1);
    let mut values = BTreeMap::new();
    while let Some(raw_flag) = arguments.next() {
        let flag = raw_flag.to_str().ok_or(CliError::Usage)?;
        if !FLAGS.contains(&flag) || values.contains_key(flag) {
            return Err(CliError::Usage);
        }
        let value = arguments.next().ok_or(CliError::Usage)?;
        if value.is_empty() {
            return Err(CliError::Usage);
        }
        values.insert(flag.to_owned(), value);
    }
    if values.len() != FLAGS.len() {
        return Err(CliError::Usage);
    }
    Ok(values)
}

fn text<'a>(values: &'a BTreeMap<String, OsString>, flag: &str) -> Result<&'a str, CliError> {
    values
        .get(flag)
        .and_then(|value| value.to_str())
        .ok_or(CliError::Usage)
}

fn run() -> Result<(), CliError> {
    let arguments = parse_args()?;
    let script_path = PathBuf::from(arguments.get("--script").ok_or(CliError::Usage)?);
    let script =
        fs::read_to_string(script_path).map_err(|_| CliError::Runtime("invalid runtime input"))?;
    let resolved = resolve_music_url(ResolveInput {
        script: &script,
        source: text(&arguments, "--source")?,
        track_id: text(&arguments, "--track-id")?,
        quality: text(&arguments, "--quality")?,
        allowed_origin: text(&arguments, "--allow-origin")?,
        allow_http_loopback: false,
    })
    .map_err(|error| match error {
        tuneflow_source_runtime_prototype::RuntimeError::InvalidInput => {
            CliError::Runtime("invalid runtime input")
        }
        tuneflow_source_runtime_prototype::RuntimeError::Initialization => {
            CliError::Runtime("source initialization failed")
        }
        tuneflow_source_runtime_prototype::RuntimeError::Protocol => {
            CliError::Runtime("source protocol failed")
        }
        tuneflow_source_runtime_prototype::RuntimeError::Network => {
            CliError::Runtime("source network request failed")
        }
        tuneflow_source_runtime_prototype::RuntimeError::Timeout => {
            CliError::Runtime("source execution timed out")
        }
        tuneflow_source_runtime_prototype::RuntimeError::InvalidResolvedUrl => {
            CliError::Runtime("source returned an invalid playback URL")
        }
    })?;
    println!("{}", summarize(&resolved));
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(CliError::Usage) => {
            eprintln!("{USAGE}");
            ExitCode::FAILURE
        }
        Err(CliError::Runtime(message)) => {
            eprintln!("source runtime failed: {message}");
            ExitCode::FAILURE
        }
    }
}

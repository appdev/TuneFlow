#!/usr/bin/env python3
"""Generate and verify TuneFlow icons for the enabled Flutter platforms."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


ANDROID_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
MACOS_SIZES = (16, 32, 64, 128, 256, 512, 1024)
WINDOWS_SIZES = (16, 24, 32, 48, 64, 128, 256)
LINUX_SIZES = (16, 32, 48, 64, 128, 256, 512)
IOS_BACKGROUND = (6, 21, 29)


def _resized(source: Image.Image, size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.LANCZOS)


def generate_android(source: Image.Image, root: Path) -> list[Path]:
    outputs = []
    for directory, size in ANDROID_SIZES.items():
        output = root / directory / "ic_launcher.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        _resized(source.convert("RGBA"), size).save(output)
        outputs.append(output)
    return outputs


def _ios_entries(appicon_dir: Path) -> list[tuple[Path, int]]:
    contents = json.loads((appicon_dir / "Contents.json").read_text())
    entries = []
    for item in contents["images"]:
        filename = item.get("filename")
        if not filename:
            continue
        logical_size = float(item["size"].split("x", maxsplit=1)[0])
        scale = float(item["scale"].removesuffix("x"))
        entries.append((appicon_dir / filename, round(logical_size * scale)))
    return entries


def generate_ios(source: Image.Image, appicon_dir: Path) -> list[Path]:
    source_rgba = source.convert("RGBA")
    outputs = []
    for output, size in _ios_entries(appicon_dir):
        foreground = _resized(source_rgba, size)
        background = Image.new("RGBA", (size, size), IOS_BACKGROUND + (255,))
        background.alpha_composite(foreground)
        background.convert("RGB").save(output)
        outputs.append(output)
    return outputs


def generate_macos(source: Image.Image, appicon_dir: Path) -> list[Path]:
    outputs = []
    source_rgba = source.convert("RGBA")
    for size in MACOS_SIZES:
        output = appicon_dir / f"app_icon_{size}.png"
        _resized(source_rgba, size).save(output)
        outputs.append(output)
    return outputs


def generate_windows(source: Image.Image, output: Path) -> list[Path]:
    output.parent.mkdir(parents=True, exist_ok=True)
    source.convert("RGBA").save(output, sizes=[(size, size) for size in WINDOWS_SIZES])
    return [output]


def generate_linux(source: Image.Image, root: Path) -> list[Path]:
    root.mkdir(parents=True, exist_ok=True)
    outputs = []
    for size in LINUX_SIZES:
        output = root / f"tuneflow-{size}.png"
        _resized(source.convert("RGBA"), size).save(output)
        outputs.append(output)
    _resized(source.convert("RGBA"), 512).save(root / "tuneflow.png")
    outputs.append(root / "tuneflow.png")
    return outputs


def _expected_outputs(platform: str, root: Path) -> list[tuple[Path, int, str]]:
    if platform == "android":
        return [
            (root / directory / "ic_launcher.png", size, "RGBA")
            for directory, size in ANDROID_SIZES.items()
        ]
    if platform == "ios":
        return [(path, size, "RGB") for path, size in _ios_entries(root)]
    if platform == "macos":
        return [
            (root / f"app_icon_{size}.png", size, "RGBA")
            for size in MACOS_SIZES
        ]
    if platform == "windows":
        return [(root, size, "RGBA") for size in WINDOWS_SIZES]
    if platform == "linux":
        return [
            (root / f"tuneflow-{size}.png", size, "RGBA")
            for size in LINUX_SIZES
        ] + [(root / "tuneflow.png", 512, "RGBA")]
    raise ValueError(f"Unsupported platform: {platform}")


def verify_icons(platform: str, root: Path) -> None:
    errors = []
    for path, size, mode in _expected_outputs(platform, root):
        if not path.is_file():
            errors.append(f"missing: {path}")
            continue
        with Image.open(path) as image:
            if platform == "windows":
                sizes = image.ico.sizes()
                if (size, size) not in sizes:
                    errors.append(
                        f"missing size: {path}: {size}x{size}; found {sorted(sizes)}"
                    )
                continue
            if image.size != (size, size):
                errors.append(f"wrong size: {path}: {image.size}, expected {size}x{size}")
            if image.mode != mode:
                errors.append(f"wrong mode: {path}: {image.mode}, expected {mode}")
    if errors:
        raise SystemExit("\n".join(errors))


def _platform_root(platform: str) -> Path:
    if platform == "android":
        return Path("android/app/src/main/res")
    if platform in ("ios", "macos"):
        return Path(platform) / "Runner/Assets.xcassets/AppIcon.appiconset"
    if platform == "windows":
        return Path("windows/runner/resources/app_icon.ico")
    if platform == "linux":
        return Path("linux/runner/resources")
    raise ValueError(f"Unsupported platform: {platform}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--platform",
        choices=("android", "ios", "macos", "windows", "linux", "all"),
        required=True,
    )
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    platforms = (
        ("android", "ios", "macos", "windows", "linux")
        if args.platform == "all"
        else (args.platform,)
    )
    if args.verify:
        for platform in platforms:
            verify_icons(platform, _platform_root(platform))
        return

    with Image.open(args.source) as source:
        for platform in platforms:
            root = _platform_root(platform)
            if platform == "android":
                generate_android(source, root)
            elif platform == "ios":
                generate_ios(source, root)
            elif platform == "macos":
                generate_macos(source, root)
            elif platform == "windows":
                generate_windows(source, root)
            else:
                generate_linux(source, root)


if __name__ == "__main__":
    main()

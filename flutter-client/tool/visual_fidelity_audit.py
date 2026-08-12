#!/usr/bin/env python3
"""Compare Flutter page captures with the approved Open Design baselines."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageOps


def _global_ssim(expected: np.ndarray, actual: np.ndarray) -> float:
    expected_luma = (
        expected[..., 0] * 0.2126
        + expected[..., 1] * 0.7152
        + expected[..., 2] * 0.0722
    )
    actual_luma = (
        actual[..., 0] * 0.2126
        + actual[..., 1] * 0.7152
        + actual[..., 2] * 0.0722
    )
    mean_expected = expected_luma.mean()
    mean_actual = actual_luma.mean()
    variance_expected = expected_luma.var()
    variance_actual = actual_luma.var()
    covariance = np.mean(
        (expected_luma - mean_expected) * (actual_luma - mean_actual)
    )
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    return float(
        ((2 * mean_expected * mean_actual + c1) * (2 * covariance + c2))
        / (
            (mean_expected**2 + mean_actual**2 + c1)
            * (variance_expected + variance_actual + c2)
        )
    )


def _edge_iou(expected: np.ndarray, actual: np.ndarray) -> float:
    def edges(image: np.ndarray) -> np.ndarray:
        luma = (
            image[..., 0] * 0.2126
            + image[..., 1] * 0.7152
            + image[..., 2] * 0.0722
        )
        horizontal = np.abs(np.diff(luma, axis=1, prepend=luma[:, :1]))
        vertical = np.abs(np.diff(luma, axis=0, prepend=luma[:1, :]))
        return (horizontal + vertical) > 28

    expected_edges = edges(expected)
    actual_edges = edges(actual)
    union = np.logical_or(expected_edges, actual_edges).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(expected_edges, actual_edges).sum() / union)


def _comparison(expected: Image.Image, actual: Image.Image) -> Image.Image:
    diff = ImageChops.difference(expected, actual)
    diff = ImageOps.autocontrast(ImageEnhance.Contrast(diff).enhance(2.0))
    width, height = expected.size
    canvas = Image.new("RGB", (width * 3, height), "black")
    canvas.paste(expected, (0, 0))
    canvas.paste(actual, (width, 0))
    canvas.paste(diff, (width * 2, 0))
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--actual", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, float, float, float]] = []
    missing: list[str] = []
    for expected_path in sorted(args.expected.glob("*.png")):
        actual_path = args.actual / expected_path.name
        if not actual_path.exists():
            missing.append(expected_path.name)
            continue
        expected_image = Image.open(expected_path).convert("RGB")
        actual_image = Image.open(actual_path).convert("RGB")
        if expected_image.size != actual_image.size:
            missing.append(
                f"{expected_path.name} (size {expected_image.size} != {actual_image.size})"
            )
            continue
        expected = np.asarray(expected_image, dtype=np.float32)
        actual = np.asarray(actual_image, dtype=np.float32)
        mae = float(np.abs(expected - actual).mean() / 255)
        close_pixels = float((np.abs(expected - actual).max(axis=2) <= 12).mean())
        ssim = _global_ssim(expected, actual)
        edge_iou = _edge_iou(expected, actual)
        rows.append((expected_path.name, ssim, mae, edge_iou))
        comparison_path = args.output / expected_path.name
        _comparison(expected_image, actual_image).save(comparison_path)

    lines = [
        "# Full UI fidelity audit",
        "",
        "Reference: approved Open Design screenshots. Each comparison image contains reference, Flutter capture, and amplified pixel diff.",
        "",
        "| Page / viewport | Luma SSIM | RGB MAE | Edge IoU | Result |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for name, ssim, mae, edge_iou in rows:
        passed = ssim >= 0.95 and mae <= 0.05 and edge_iou >= 0.75
        lines.append(
            f"| [{name}](../../build/visual-audit/{name}) | {ssim:.4f} | {mae:.4f} | {edge_iou:.4f} | {'PASS' if passed else 'FAIL'} |"
        )
    if rows:
        lines.extend(
            [
                "",
                f"Compared: {len(rows)}; passed: {sum(ssim >= 0.95 and mae <= 0.05 and edge >= 0.75 for _, ssim, mae, edge in rows)}; failed: {sum(not (ssim >= 0.95 and mae <= 0.05 and edge >= 0.75) for _, ssim, mae, edge in rows)}.",
                f"Mean SSIM: {np.mean([row[1] for row in rows]):.4f}; mean RGB MAE: {np.mean([row[2] for row in rows]):.4f}; mean edge IoU: {np.mean([row[3] for row in rows]):.4f}.",
            ]
        )
    if missing:
        lines.extend(["", "Missing or incompatible captures:", ""])
        lines.extend(f"- {item}" for item in missing)
    args.report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[-4:]))
    return 1 if missing or any(
        not (ssim >= 0.95 and mae <= 0.05 and edge >= 0.75)
        for _, ssim, mae, edge in rows
    ) else 0


if __name__ == "__main__":
    raise SystemExit(main())

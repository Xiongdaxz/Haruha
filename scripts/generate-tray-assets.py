from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "src" / "assets"
TRAY_SIZE = 256
TRAY_GLYPH_SIZE = 224
ACTIVE_COLOR = (8, 116, 67)
OFF_COLOR = (100, 116, 139)


def restore_transparency(image: Image.Image) -> Image.Image:
    if image.getchannel("A").getextrema()[0] < 255:
        return image

    restored = Image.new("RGBA", image.size, (0, 0, 0, 0))
    restored_pixels = []
    for red, green, blue, _ in image.getdata():
        green_excess = green - max(red, blue)
        alpha = max(0, min(255, (green_excess - 2) * 16))
        restored_pixels.append((red, green, blue, alpha))
    restored.putdata(restored_pixels)
    return restored


def solid_color(image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    alpha = image.getchannel("A")
    result = Image.new("RGBA", image.size, (*color, 0))
    result.putalpha(alpha)
    return result


def make_tray_glyph(source: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    bounds = source.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("托盘图标源图没有可见像素")

    cropped = source.crop(bounds)
    cropped.thumbnail((TRAY_GLYPH_SIZE, TRAY_GLYPH_SIZE), Image.Resampling.LANCZOS)
    glyph = solid_color(cropped, color)
    canvas = Image.new("RGBA", (TRAY_SIZE, TRAY_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(glyph, ((TRAY_SIZE - glyph.width) // 2, (TRAY_SIZE - glyph.height) // 2))
    return canvas


def make_preview(active: Image.Image, off: Image.Image, output: Path) -> None:
    scales = (16, 20, 24, 32)
    preview = Image.new("RGB", (560, 208), "#eef2f7")
    draw = ImageDraw.Draw(preview)
    draw.text((20, 14), "ACTIVE", fill="#0f172a")
    draw.text((300, 14), "OFF", fill="#0f172a")

    for column, icon in enumerate((active, off)):
        platform_icon = Image.new("RGBA", (TRAY_SIZE, TRAY_SIZE), (0, 0, 0, 0))
        platform_draw = ImageDraw.Draw(platform_icon)
        platform_draw.rounded_rectangle((0, 0, 255, 255), 42, fill="#ffffff")
        platform_icon.alpha_composite(icon)
        base_x = 20 + column * 280
        for index, size in enumerate(scales):
            background = "#ffffff" if index % 2 == 0 else "#172033"
            tile_x = base_x + index * 64
            tile_y = 50
            draw.rounded_rectangle((tile_x, tile_y, tile_x + 52, tile_y + 52), 10, fill=background)
            resized = platform_icon.resize((size, size), Image.Resampling.LANCZOS)
            preview.paste(
                resized,
                (tile_x + (52 - size) // 2, tile_y + (52 - size) // 2),
                resized,
            )
            draw.text((tile_x + 16, 112), str(size), fill="#475569")

    preview.resize((1120, 416), Image.Resampling.NEAREST).save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 Haruha 托盘专用 PNG/RGBA 素材")
    parser.add_argument("source", type=Path, help="透明背景 PNG 源图")
    parser.add_argument("--preview", type=Path, help="可选的小尺寸对比预览输出")
    args = parser.parse_args()

    source = restore_transparency(Image.open(args.source).convert("RGBA"))
    active = make_tray_glyph(source, ACTIVE_COLOR)
    off = make_tray_glyph(source, OFF_COLOR)

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    source.save(ASSET_DIR / "haruha-tray-logo-source.png")
    active.save(ASSET_DIR / "haruha-tray-logo.png")
    off.save(ASSET_DIR / "haruha-tray-logo-off.png")
    if args.preview:
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        make_preview(active, off, args.preview)

    alpha_range = source.getchannel("A").getextrema()
    print(f"source={source.size[0]}x{source.size[1]} alpha={alpha_range}")
    print(f"active={ASSET_DIR / 'haruha-tray-logo.png'}")
    print(f"rgba_bytes={len(active.tobytes())}")


if __name__ == "__main__":
    main()

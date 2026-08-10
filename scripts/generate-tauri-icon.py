from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "assets" / "haruha-tray-logo.png"
OFF_SOURCE = ROOT / "src" / "assets" / "haruha-tray-logo-off.png"
ICON_DIR = ROOT / "src-tauri" / "icons"
TRAY_ICON_SIZE = 32


def make_icon_canvas(source: Image.Image, size: int) -> Image.Image:
    margin = max(2, int(size * 0.07))
    target = size - margin * 2
    leaf = ImageOps.contain(source, (target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = max(3, round(size * 0.17))
    ImageDraw.Draw(canvas).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill="white")
    canvas.alpha_composite(leaf, ((size - leaf.width) // 2, (size - leaf.height) // 2))
    return canvas


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    bounds = image.getbbox()
    if bounds:
        image = image.crop(bounds)

    off_image = Image.open(OFF_SOURCE).convert("RGBA")
    off_bounds = off_image.getbbox()
    if off_bounds:
        off_image = off_image.crop(off_bounds)

    icon_256 = make_icon_canvas(image, 256)
    icon_256.save(ICON_DIR / "icon.png")
    icon_256.save(
        ICON_DIR / "icon.ico",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )

    tray_icon = make_icon_canvas(image, TRAY_ICON_SIZE)
    tray_icon_off = make_icon_canvas(off_image, TRAY_ICON_SIZE)
    tray_icon.save(ICON_DIR / "haruha-tray-icon-32.png")
    tray_icon_off.save(ICON_DIR / "haruha-tray-icon-off-32.png")
    (ICON_DIR / "haruha-tray-icon-32.rgba").write_bytes(tray_icon.tobytes())
    (ICON_DIR / "haruha-tray-icon-off-32.rgba").write_bytes(tray_icon_off.tobytes())


if __name__ == "__main__":
    main()

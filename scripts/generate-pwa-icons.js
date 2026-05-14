/**
 * يولّد أيقونات PWA (PNG) من المصدر الموحّد:
 *   1) public/brand-icon.svg (مفضّل — متناسق مع ألوان الموقع)
 *   2) أو site-logo.png / .jpg / .webp
 *
 * التنفيذ: npm run build:icons
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const pub = path.join(__dirname, "..", "public");
const svgPath = path.join(pub, "brand-icon.svg");
const rasterNames = ["site-logo.png", "site-logo.jpg", "site-logo.jpeg", "site-logo.webp"];

function findInput() {
    if (fs.existsSync(svgPath)) return svgPath;
    for (const n of rasterNames) {
        const p = path.join(pub, n);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const input = findInput();
if (!input) {
    console.error(
        "لم يُعثر على مصدر أيقونة. أضف public/brand-icon.svg أو site-logo.png في public/ ثم أعد التشغيل."
    );
    process.exit(1);
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function renderPng(size, file) {
    await sharp(input)
        .resize(size, size, {
            fit: "contain",
            background: transparent,
            kernel: sharp.kernel.lanczos3
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(path.join(pub, file));
}

(async () => {
    await renderPng(192, "icon-192.png");
    await renderPng(512, "icon-512.png");
    await renderPng(180, "apple-touch-icon.png");
    console.log(
        "تم التحديث: icon-192.png و icon-512.png و apple-touch-icon.png من",
        path.basename(input)
    );
})().catch(err => {
    console.error(err);
    process.exit(1);
});

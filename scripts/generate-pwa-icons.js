/**
 * يولّد icon-192.png و icon-512.png من شعار الموقع.
 * ضع ملفك (من الإنترنت أو أي مصدر) في public/ باسم:
 *   site-logo.png  أو  site-logo.jpg  أو  site-logo.webp
 * ثم نفّذ: npm run build:icons
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const pub = path.join(__dirname, "..", "public");
const names = ["site-logo.png", "site-logo.jpg", "site-logo.jpeg", "site-logo.webp"];

function findInput() {
    for (const n of names) {
        const p = path.join(pub, n);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const input = findInput();
if (!input) {
    console.error(
        "لم يُعثر على شعار. انسخ ملف الشعار إلى مجلد public/ باسم site-logo.png (أو .jpg / .webp) ثم أعد التشغيل."
    );
    process.exit(1);
}

const bg = { r: 0, g: 0, b: 0, alpha: 0 };

async function out(size, file) {
    await sharp(input)
        .resize(size, size, {
            fit: "contain",
            background: bg,
            kernel: sharp.kernel.lanczos3
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(path.join(pub, file));
}

(async () => {
    await out(192, "icon-192.png");
    await out(512, "icon-512.png");
    console.log("تم التحديث: icon-192.png و icon-512.png من", path.basename(input));
})().catch(err => {
    console.error(err);
    process.exit(1);
});

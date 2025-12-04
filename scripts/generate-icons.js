// Простой скрипт для создания иконок PWA
// Запуск: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, '../public/icons');

// Создаем директорию если её нет
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Создаем простой SVG иконку (коробка)
const createSVGIcon = (size) => {
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#1e293b"/>
  <!-- Основная часть коробки -->
  <rect x="${size * 0.3}" y="${size * 0.4}" width="${size * 0.4}" height="${size * 0.4}" fill="#3b82f6"/>
  <!-- Верх коробки -->
  <polygon points="${size * 0.3},${size * 0.4} ${size * 0.5},${size * 0.25} ${size * 0.7},${size * 0.4} ${size * 0.5},${size * 0.4}" fill="#2563eb"/>
  <!-- Боковая сторона -->
  <polygon points="${size * 0.7},${size * 0.4} ${size * 0.8},${size * 0.25} ${size * 0.8},${size * 0.65} ${size * 0.7},${size * 0.8}" fill="#1e40af"/>
</svg>`;
};

// Для каждого размера создаем SVG (можно конвертировать в PNG позже)
sizes.forEach(size => {
  const svg = createSVGIcon(size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.svg`), svg);
  console.log(`Created icon-${size}x${size}.svg`);
});

console.log('\nИконки созданы! Для использования в PWA нужно конвертировать SVG в PNG.');
console.log('Можно использовать онлайн-конвертер или ImageMagick:');
console.log('convert icon-192x192.svg icon-192x192.png');


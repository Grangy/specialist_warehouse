import { NextResponse } from 'next/server';
import { readdirSync } from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const dynamic = 'force-dynamic';

/** GET /api/photo/random — вернуть путь к случайной фотке из public/photo */
export async function GET() {
  try {
    const photoDir = path.join(process.cwd(), 'public', 'photo');
    let entries: string[];
    try {
      entries = readdirSync(photoDir);
    } catch {
      return NextResponse.json({ url: null, error: 'Папка photo не найдена' }, { status: 404 });
    }

    const images = entries.filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    });

    if (images.length === 0) {
      return NextResponse.json({ url: null, error: 'Нет подходящих файлов' });
    }

    const randomIndex = Math.floor(Math.random() * images.length);
    const filename = images[randomIndex];
    const url = `/photo/${encodeURIComponent(filename)}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error('Ошибка при получении случайной фотки:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера' },
      { status: 500 }
    );
  }
}

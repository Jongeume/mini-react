# record-redis.mjs 가 찍은 프레임(docs/demo/frames/4-redis-cache)으로 오목 × Mini Redis 시연 GIF 를 만든다
# 실행 : python docs/demo/make_redis_gif.py   (Pillow 필요)
# 왼쪽 : 판 일부 · 대국 기록 상자(화면의 Redis 명령 → 응답), 오른쪽 : 그 장면에서 새로 생긴 백엔드 로그 · Mini Redis EXEC 로그
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FRAMES = HERE / 'frames' / '4-redis-cache'
FONT = 'C:/Windows/Fonts/malgun.ttf'
FONT_BOLD = 'C:/Windows/Fonts/malgunbd.ttf'
MONO = 'C:/Windows/Fonts/consola.ttf'
INK = (25, 31, 40)
GREEN = (5, 209, 132)
TEAL = (30, 77, 75)
PAPER = (242, 246, 244)
DIM = (150, 165, 175)


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def wrap(draw, text, fnt, width):
    """글자 단위로 width 안에 들어가게 여러 줄로 나눈다"""
    lines, line = [], ''
    for ch in text:
        if draw.textlength(line + ch, font=fnt) > width:
            lines.append(line)
            line = ch
        else:
            line += ch
    if line:
        lines.append(line)
    return lines


def short_backend(line):
    """백엔드 로그 한 줄을 '이유 · 명령 → 응답' 으로 줄인다 (시각과 HTTP 경로는 앞에 남김)"""
    m = re.match(r'(\S+) (GET|POST) (\S+) reason=(\S+) cmd="(.*)" reply=(.*)$', line)
    if m:
        t, method, url, reason, cmd, rep = m.groups()
        return f'{t} {method} {url}\n  {reason}: {cmd} → {rep}'
    return line


def short_redis(line):
    """Mini Redis 로그 한 줄에서 경과 시각 · 순번 · 명령 · 응답만 남긴다"""
    line = line.split(' | reply queued')[0]
    return re.sub(r'^\[\+ *', '[+', line).replace('EXEC ', '')


def log_panel(frame, width, height):
    """오른쪽 로그 패널 : 이번 장면에 백엔드가 보낸 명령과 Mini Redis 가 실행한 결과"""
    img = Image.new('RGB', (width, height), INK)
    d = ImageDraw.Draw(img)
    mono = ImageFont.truetype(MONO, 15)
    y = 16
    for title, lines in (('오목 백엔드 로그 (stdout)', [short_backend(l) for l in frame['backend']]),
                         ('Mini Redis 시연 로그 (--log)', [short_redis(l) for l in frame['redis']])):
        d.text((18, y), title, font=font(17, True), fill=GREEN)
        y += 30
        if not lines:
            d.text((18, y), '(이 장면에서 보낸 명령 없음)', font=font(15), fill=DIM)
            y += 26
        for entry in lines:
            for part in entry.split('\n'):
                for piece in wrap(d, part, mono, width - 36):
                    d.text((18, y), piece, font=mono, fill='white')
                    y += 21
            y += 6
        y += 18
    return img


def cut(img, box, pad):
    x1, y1, x2, y2 = box
    return img.crop((x1 - pad, y1 - pad, x2 + pad, y2 + pad))


def caption_bar(img, label, text):
    w = img.width
    tmp = ImageDraw.Draw(img)
    lw = int(tmp.textlength(label, font=font(18, True))) + 20
    lines = wrap(tmp, text, font(20), w - lw - 72)
    h = max(64, 24 + 30 * len(lines))
    out = Image.new('RGB', (w, img.height + h), INK)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    y0 = img.height
    d.rounded_rectangle([24, y0 + 16, 24 + lw, y0 + 48], radius=8, fill=GREEN)
    d.text((34, y0 + 18), label, font=font(18, True), fill='white')
    for i, line in enumerate(lines):
        d.text((24 + lw + 24, y0 + 16 + 30 * i), line, font=font(20), fill='white')
    return out


def main():
    meta = json.loads((FRAMES / 'frames.json').read_text(encoding='utf-8'))['frames']
    rec_w = max(f['regions']['record'][2] - f['regions']['record'][0] for f in meta) + 24
    rec_h = max(f['regions']['record'][3] - f['regions']['record'][1] for f in meta) + 24
    out_frames, durations = [], []
    for f in meta:
        shot = Image.open(FRAMES / f['file']).convert('RGB')
        board = cut(shot, f['regions']['board'], 12)
        record = Image.new('RGB', (rec_w, rec_h), PAPER)
        record.paste(cut(shot, f['regions']['record'], 12), (0, 0))
        left_h = board.height + 16 + rec_h
        left = Image.new('RGB', (max(board.width, rec_w), left_h), PAPER)
        left.paste(board, (0, 0))
        left.paste(record, (0, board.height + 16))
        panel = log_panel(f, 620, left_h + 40)
        canvas = Image.new('RGB', (left.width + 40 + panel.width, left_h + 40), PAPER)
        canvas.paste(left, (20, 20))
        canvas.paste(panel, (left.width + 40, 0))
        out_frames.append(caption_bar(canvas, f['scene'], f['caption']))
        durations.append(f['ms'])
    height = max(img.height for img in out_frames)
    width = 960
    norm = []
    for img in out_frames:
        canvas = Image.new('RGB', (img.width, height), INK)
        canvas.paste(img, (0, 0))
        canvas = canvas.resize((width, round(canvas.height * width / canvas.width)), Image.LANCZOS)
        norm.append(canvas.convert('P', palette=Image.ADAPTIVE, colors=128))
    out = HERE / 'demo-4-redis-cache.gif'
    norm[0].save(out, save_all=True, append_images=norm[1:], duration=durations, loop=0, optimize=True, disposal=2)
    print(out.name, f'{out.stat().st_size // 1024} KB', f'{sum(durations) / 1000:.1f}s')


if __name__ == '__main__':
    main()

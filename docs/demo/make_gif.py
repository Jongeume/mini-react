# record.mjs 가 찍은 프레임(docs/demo/frames)을 자막을 붙여 README 용 GIF 로 만든다
# 실행 : python docs/demo/make_gif.py   (Pillow 필요)
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FRAMES = HERE / 'frames'
FONT = 'C:/Windows/Fonts/malgun.ttf'
FONT_BOLD = 'C:/Windows/Fonts/malgunbd.ttf'
INK = (25, 31, 40)
BLUE = (5, 209, 132)
TEAL = (30, 77, 75)
PAPER = (242, 246, 244)


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def wrap(draw, text, fnt, width):
    """자막을 width 안에 들어가게 여러 줄로 나눈다"""
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


def caption_bar(img, text, label=None):
    """그림 아래에 짙은 자막 띠를 붙인다 (label 은 왼쪽 파란 꼬리표)"""
    w = img.width
    fnt = font(20)
    tmp = ImageDraw.Draw(img)
    left = 24
    if label:
        left += int(tmp.textlength(label, font=font(18, True))) + 36
    lines = wrap(tmp, text, fnt, w - left - 24) if text else []
    h = max(64, 24 + 30 * max(1, len(lines)))
    out = Image.new('RGB', (w, img.height + h), INK)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    y0 = img.height
    if label:
        lw = int(d.textlength(label, font=font(18, True))) + 20
        d.rounded_rectangle([24, y0 + 16, 24 + lw, y0 + 48], radius=8, fill=BLUE)
        d.text((34, y0 + 18), label, font=font(18, True), fill='white')
    for i, line in enumerate(lines):
        d.text((left, y0 + 14 + 30 * i), line, font=fnt, fill='white')
    return out


def load(name, raw=False):
    meta = json.loads((FRAMES / name / 'frames.json').read_text(encoding='utf-8'))
    imgs = []
    for f in meta['frames']:
        img = Image.open(FRAMES / name / f['file']).convert('RGB')
        if meta.get('crop') and not raw:
            img = img.crop(tuple(meta['crop']))
        imgs.append((img, f))
    return meta, imgs


def save_gif(frames, durations, out, width):
    """프레임 크기를 맞추고 팔레트로 줄여 GIF 로 저장한다"""
    h = max(f.height for f in frames)
    norm = []
    for f in frames:
        canvas = Image.new('RGB', (f.width, h), INK)
        canvas.paste(f, (0, 0))
        if canvas.width != width:
            canvas = canvas.resize((width, round(canvas.height * width / canvas.width)), Image.LANCZOS)
        norm.append(canvas.convert('P', palette=Image.ADAPTIVE, colors=128))
    norm[0].save(out, save_all=True, append_images=norm[1:], duration=durations, loop=0, optimize=True, disposal=2)
    print(out.name, f'{out.stat().st_size // 1024} KB', f'{sum(durations) / 1000:.1f}s')


def simple(name, out_name):
    meta, imgs = load(name)
    frames = [caption_bar(img, f['caption']) for img, f in imgs]
    save_gif(frames, [f['ms'] for _, f in imgs], HERE / out_name, meta.get('width', 960))


def batch(out_name):
    """v0 · v2 를 같은 순간끼리 나란히 붙이고, 찍을 때 센 커밋 수로 자막을 만든다"""
    _, v0 = load('3-batch-v0', raw=True)
    _, v2 = load('3-batch-v2-microtask', raw=True)
    gap, head = 24, 56
    frames, durations = [], []
    steps = ['패널을 연다 — 커밋 기록은 최근 순', '같은 칸에 착수 1번', '1초 타이머가 한 번 울림 (엔진 이벤트 밖의 setter 2개)']
    for i, ((a, fa), (b, fb)) in enumerate(zip(v0, v2)):
        w = a.width + gap + b.width
        canvas = Image.new('RGB', (w, a.height + head), (242, 244, 246))
        d = ImageDraw.Draw(canvas)
        d.text((16, 14), 'v0 배칭 없음', font=font(22, True), fill=INK)
        d.text((a.width + gap + 16, 14), 'v2 마이크로태스크 배칭', font=font(22, True), fill=BLUE)
        canvas.paste(a, (0, head))
        canvas.paste(b, (a.width + gap, head))
        if 'move' in fa:
            text = f"{steps[i]} → 커밋 v0 {fa['move']}번 · v2 {fb['move']}번"
        elif 'tick' in fa:
            text = f"{steps[i]} → 커밋 v0 {fa['tick']}번 · v2 {fb['tick']}번"
        else:
            text = steps[i]
        frames.append(caption_bar(canvas, text, label=f'{i + 1}/{len(v0)}'))
        durations.append(fa['ms'])
    save_gif(frames, durations, HERE / out_name, frames[0].width)


def box_size(imgs, key, padx, pady=None):
    """모든 프레임에서 그 영역의 가장 큰 크기 (프레임마다 잘라도 크기가 같아야 GIF 가 흔들리지 않는다)"""
    pady = padx if pady is None else pady
    w = max(f['regions'][key][2] - f['regions'][key][0] for _, f in imgs) + padx * 2
    h = max(f['regions'][key][3] - f['regions'][key][1] for _, f in imgs) + pady * 2
    return w, h


def cut(img, f, key, size, padx, pady=None, max_w=None, max_h=None):
    """그 프레임의 영역만 잘라 size 크기 바탕에 붙인다 (남는 곳은 바탕색, 영역 밖 내용은 넣지 않는다)"""
    pady = padx if pady is None else pady
    x1, y1, x2, y2 = f['regions'][key]
    piece = img.crop((x1 - padx, y1 - pady, x2 + padx, y2 + pady))
    w, h = size
    if max_w: w = min(w, max_w)
    if max_h: h = min(h, max_h)
    out = Image.new('RGB', (w, h), PAPER)
    out.paste(piece, (0, 0))
    return out


def labeled(img, label, scale=1.0):
    """잘라 낸 영역 위에 작은 이름표를 붙인다"""
    if scale != 1.0:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    out = Image.new('RGB', (img.width, img.height + 34), PAPER)
    d = ImageDraw.Draw(out)
    d.text((4, 6), label, font=font(17, True), fill=TEAL)
    out.paste(img, (0, 34))
    return out


def row(parts, gap=24):
    w = sum(p.width for p in parts) + gap * (len(parts) - 1)
    h = max(p.height for p in parts)
    out = Image.new('RGB', (w, h), PAPER)
    x = 0
    for p in parts:
        out.paste(p, (x, 0))
        x += p.width + gap
    return out


def col(parts, gap=18):
    w = max(p.width for p in parts)
    h = sum(p.height for p in parts) + gap * (len(parts) - 1)
    out = Image.new('RGB', (w, h), PAPER)
    y = 0
    for p in parts:
        out.paste(p, (0, y))
        y += p.height + gap
    return out


def framed(img, margin=20):
    out = Image.new('RGB', (img.width + margin * 2, img.height + margin * 2), PAPER)
    out.paste(img, (margin, margin))
    return out


def clean(text):
    text = re.sub(r' \(커밋 #\d+ · [^)]*\)', '', text)
    return text.replace(' — ', ', ').replace('—', ',')


def zoom_patch(out_name):
    """시연 1 : 실제 영역(바뀐 글자) · 테스트 영역 첫 줄들 · 마지막 Patch 목록만"""
    _, imgs = load('1-diff-patch', raw=True)
    a, t, l = box_size(imgs, 'actual', 14), box_size(imgs, 'test', 0), box_size(imgs, 'log', 0)
    frames = []
    for img, f in imgs:
        top = row([labeled(cut(img, f, 'actual', a, 14, max_w=400), '실제 영역 (Patch 로만 바뀜)'),
                   labeled(cut(img, f, 'test', t, 0, max_w=470, max_h=a[1]), '테스트 영역 (HTML 수정)')])
        log = cut(img, f, 'log', l, 0, max_w=640)
        frames.append(caption_bar(framed(col([top, log])), clean(f['caption'])))
    save_gif(frames, [f['ms'] for _, f in imgs], HERE / out_name, 960)


def zoom_hooks(out_name):
    """시연 2 : 돌 주변 판(2배) · hooks 0번 · 1번 칸 · 마지막 diff 명령만"""
    _, imgs = load('2-hooks-render', raw=True)
    b = box_size(imgs, 'board', 10)
    k = (box_size(imgs, 'hooks', 0)[0] + 30, box_size(imgs, 'hooks', 0)[1] + 4)
    lg = (box_size(imgs, 'log', 0)[0] + 30, box_size(imgs, 'log', 0)[1] + 4)
    frames = []
    for img, f in imgs:
        left = labeled(cut(img, f, 'board', b, 10), '판 (돌 주변, 2배)', scale=2.0)
        right = col([labeled(cut(img, f, 'hooks', k, 25, 2), 'hooks 배열 (0번 판 기록, 1번 현재 수)', scale=1.4),
                     labeled(cut(img, f, 'log', lg, 25, 2), '커밋 기록 (최근 3개)', scale=1.4)])
        frames.append(caption_bar(framed(row([left, right])), clean(f['caption'])))
    save_gif(frames, [f['ms'] for _, f in imgs], HERE / out_name, 960)


def zoom_batch(out_name):
    """시연 3 : v0 · v2 의 엔진 이름과 커밋 기록만 나란히"""
    _, v0 = load('3-batch-v0', raw=True)
    _, v2 = load('3-batch-v2-microtask', raw=True)
    pad = 8
    sel = box_size(v0 + v2, 'select', pad)
    log = box_size(v0 + v2, 'log', pad)
    steps = ['패널을 연다 (커밋 기록은 최근 순)', '같은 칸에 착수 1번', '1초 타이머가 한 번 울림 (엔진 이벤트 밖의 setter 2개)']
    frames, durations = [], []
    for i, ((a, fa), (b, fb)) in enumerate(zip(v0, v2)):
        sides = []
        for img, f, title in ((a, fa, 'v0 배칭 없음'), (b, fb, 'v2 마이크로태스크 배칭')):
            sides.append(labeled(col([cut(img, f, 'select', sel, pad), cut(img, f, 'log', log, pad)], gap=8), title))
        if 'move' in fa:
            text = f"{steps[i]} → 커밋 v0 {fa['move']}번 · v2 {fb['move']}번"
        elif 'tick' in fa:
            text = f"{steps[i]} → 커밋 v0 {fa['tick']}번 · v2 {fb['tick']}번"
        else:
            text = steps[i]
        frames.append(caption_bar(framed(row(sides, gap=40)), text, label=f'{i + 1}/{len(v0)}'))
        durations.append(fa['ms'])
    save_gif(frames, durations, HERE / out_name, 960)


if __name__ == '__main__':
    zoom_patch('demo-1-diff-patch.gif')
    zoom_hooks('demo-2-hooks-render.gif')
    zoom_batch('demo-3-batching.gif')

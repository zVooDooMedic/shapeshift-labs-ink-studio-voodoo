# Reference sources

Everything the tutorials call "the reference look" comes from one clip, plus the
36 clips already in `~/SafeHouse/Games/sdf-splat-pixel/reference/`.

## The clip these lessons were written from

| | |
|---|---|
| Post | `https://x.com/anxuanng/status/2122562880373686278/video/1` |
| Local copy | `~/SafeHouse/Games/sdf-splat-pixel/reference/crucible_splat_ref_2122375294699159552.mp4` |
| Format | 1200×1200, h264 + aac, 36.05 s, 864 frames @ 24 fps, 18.4 MB |
| Manifest row | `2122562880373686278 → crucible-4spp-2x2-squash` in `reference/manifest.tsv` |
| All stills | `~/SafeHouse/Games/sdf-splat-pixel/reference/crucible_ref_frames/` |

## Frames copied here

- `ref-01-title-card.png` — the author's own title card, **"how this pixel art is
  made"**. Read this first: the video is a tutorial, and the five steps in our
  lessons are its own narration.
- `ref-02-ramp-legend.png` — the frame carrying the legend
  **"3 one colour ramp per material"**, with five material ramps of 4-5 shades
  down the side. This is the specification for `05-squash-and-snap.md`, and it is
  where the "ramp membership, not colour count" rule was read from.
- `ref-03-scene.png` — a plain scene frame: check the edge pixels with your own
  eyes and confirm no black outline exists anywhere.

## Reading a new reference clip

```bash
cd ~/SafeHouse/Games/sdf-splat-pixel/reference
yt-dlp --no-playlist -f "bv*+ba/b" --merge-output-format mp4 \
  -o "<label>_%(id)s.%(ext)s" "<url>"
ffprobe -v error -show_entries format=duration,size:stream=width,height,nb_frames <file>
ffmpeg -v error -y -i <file> -vf "fps=1/6" <label>_frames/f_%02d.png
```

Then **read a still with vision before writing down what the renderer "should"
do**. Every rule in these lessons was read off a frame. The legends on screen are
the specification; a video with no legend is a mood board, not a spec.

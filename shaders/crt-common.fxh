// DeckyCRT :: the CRT raster arithmetic every bundled shader shares.
//
// One owner for pattern geometry. These are plain functions, on purpose: a
// slider is baked per-preset into each shader's OWN uniform initializers (the
// backend rewrites them by preset id), so a uniform declared in here would be
// shared by all fourteen presets at once and a slider would stop being
// per-preset.
//
// Why the patterns are locked to a source line count and not to the output
// grid. This box drives 3840x2160. A scanline period of two OUTPUT rows is
// 1080 dark rows across the picture, well below what the eye resolves from the
// couch, so it reads as a flat grey veil rather than as scanlines; and a triad
// of three OUTPUT columns sits at the panel's own stripe pitch, where it beats
// against the panel and shimmers as coloured noise. Both patterns therefore
// scale with the tube being emulated. SourceLines is how many scanlines that
// tube had — 240 for a 15 kHz set, 224 for an arcade monitor, 272 for the
// PPSSPP CRT shader, 480 for a PVM. It is also why the community RetroCRT
// shader is the one that looks closest to right on this machine: it hardcodes
// 272 lines, and the bundled set never had the knob.
//
// The pattern functions take coordinates as arguments (output pixels, and 0..1
// uv for the beam) so their geometry can be reasoned about and tested from
// their arguments alone. Only the pitch helper reads BUFFER_HEIGHT, because
// translating a source line into output pixels is exactly what it is for.

// Where we are inside the current source line: 0 exactly on the boundary
// between two lines, 1 at the middle of one. Over a full screen this value is
// uniformly distributed on [0,1] — that is what makes the brightness
// compensation below exact rather than a fudge factor.
float CrtLineEdge(float y, float sourceLines)
{
    float phase = frac(y * max(sourceLines, 1.0));
    return min(phase, 1.0 - phase) * 2.0;
}

// Beam profile: bright across the middle of a line, falling to nothing at the
// boundary between lines. `gap` is the fraction of the line spent ramping back
// up, so gap 0.5 is a 75% duty cycle. Real tubes sit around 70-80% (gap
// 0.4-0.6), an arcade monitor is crisper, a soft consumer set blurrier.
float CrtBeam(float edge, float gap)
{
    return smoothstep(0.0, max(gap, 0.001), edge);
}

// Mean of CrtBeam over a full screen. CrtLineEdge is uniform on [0,1] and any
// monotone ramp has a mean of 0.5 over its own range, so the mean of the beam
// is 1 - gap/2 whatever shape the ramp has. (smoothstep's mean over [0,1] is
// exactly 0.5, which is why the shape can be swapped without retuning this.)
float CrtBeamMean(float gap)
{
    return 1.0 - max(gap, 0.001) * 0.5;
}

// Mean of `1 - scanIntensity * (1 - beam)` over a full screen: the divisor that
// keeps average brightness where the game put it. This replaces the old
// "colour *= 1 + ScanIntensity * 0.30" line, which had no relation to the duty
// cycle, so darkening the lines harder also brightened the compensation harder
// and the picture went flat instead of gaining contrast.
float CrtScanMean(float scanIntensity, float gap)
{
    return 1.0 - scanIntensity * (1.0 - CrtBeamMean(gap));
}

// Barrel distortion around the centre. `uv` is 0..1 across the output.
float2 CrtWarp(float2 uv, float curvature)
{
    float2 c = uv * 2.0 - 1.0;
    c *= 1.0 + curvature * dot(c, c);
    return c * 0.5 + 0.5;
}

// 1 inside the warped tube, 0 outside it. Step products rather than a branch so
// the compiler keeps one path.
float CrtInside(float2 uv)
{
    return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
}

// Mask pitch in output pixels: one triad per source pixel, but never finer than
// 8 output pixels. A stripe narrower than that lands below what the panel can
// show and aliases into exactly the coloured noise this replaces, which is what
// happens to a 480-line PVM mask at 4K if the pitch is not floored.
float CrtMaskPitch(float sourceLines, float scale)
{
    return max(BUFFER_HEIGHT / max(sourceLines, 1.0), 8.0) * max(scale, 0.5);
}

// One triad of soft RGB stripes per `pitch` output pixels. `soft` is the stripe
// edge width in stripe units (0.5 makes the stripes meet, 0.35 leaves a dark
// gap between them). A hard edge here aliases into coloured noise on a 4K
// panel, which is what the old step()-based masks produced.
float3 CrtGrille(float x, float pitch, float soft)
{
    float s = frac(x / max(pitch, 1.0)) * 3.0;
    return float3(
        1.0 - smoothstep(0.0, soft, abs(s - 0.5)),
        1.0 - smoothstep(0.0, soft, abs(s - 1.5)),
        1.0 - smoothstep(0.0, soft, abs(s - 2.5)));
}

// The mask pattern in output-pixel coordinates. `stagger` offsets alternate
// rows by that fraction of a triad: 0 is an aperture grille (unbroken vertical
// stripes), 0.5 is the classic staggered slot/dot mask. `rowPitch` is how many
// output rows one mask row occupies — pass the stripe pitch for square source
// pixels.
float3 CrtMaskPattern(float2 pixel, float pitch, float soft, float stagger,
                      float rowPitch)
{
    float row = floor(pixel.y / max(rowPitch, 1.0));
    float odd = step(1.0, frac(row * 0.5) * 2.0);
    return CrtGrille(pixel.x + odd * stagger * pitch, pitch, soft);
}

// Mean of the mask multiplier per channel, given the same `soft` the pattern
// was drawn with: a stripe covers only 2*soft of its 1/3 of the triad at half
// weight, so the lit share per channel is soft/3, NOT 1/3. Dividing by this is
// what puts the picture's average brightness back. (Getting it wrong by taking
// 1/3 made every masked preset ~4% darker than intended, which is the same
// class of defect as the fudge this replaced.) The lit stripe overshoots on
// pure white; that is what a real mask does — a shadow-mask tube throws most of
// the beam away and makes up for it with beam current.
float CrtMaskMean(float strength, float soft)
{
    return 1.0 - strength * (1.0 - min(soft, 0.5) / 3.0);
}

float3 CrtMask(float3 color, float3 lit, float strength)
{
    return color * lerp(float3(1.0, 1.0, 1.0), lit, strength);
}

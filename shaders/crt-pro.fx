// DeckyCRT :: CRT Pro — two-pass aperture-grille tube
//
// The flagship: everything the single-pass presets do, plus halation. Pass 0
// builds the glow source (the light a bright element throws onto the phosphor
// around it); pass 1 is the tube — curvature, source-locked beam and grille,
// glow filling the scanline gaps, chroma deconvergence, vignette.
//
// Written for Gamescope's reshadefx, which is a subset of ReShade FX. Every
// idiom here was proven to compile on gamescope 3.16.31-ogc2+:
//   - no fmod (use frac)
//   - no scalar vector splats (float3(1.0) is rejected; write all three)
//   - no implicit vector truncation (X3206 is fatal here)
//   - pixel shader parameters match the vertex shader semantics exactly
//   - no annotations on uniforms; the plugin declares the sliders
//
// The raster geometry lives in crt-common.fxh and scales off SourceLines rather
// than off the output grid. What the old version of this shader got wrong, in
// order of how visible it was: a beam per two OUTPUT rows (invisible at 4K), a
// triad per three OUTPUT columns (aliasing noise against the panel's own
// stripes), a mask gain of 1/0.60 that clipped the lit channel green, and a
// brightness fudge unrelated to the duty cycle. All four are gone.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

// No semantic on this one: Gamescope only creates a texture for declarations
// without a semantic, and a missing intermediate would silently fall back to
// the sharp frame (killing the glow) rather than failing loudly.
texture BufferA { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
sampler SamplerA { Texture = BufferA; };

uniform float SourceLines = 240;   // scanlines the emulated tube had
uniform float ScanIntensity = 0.35;
uniform float MaskStrength = 0.18;
uniform float MaskScale = 1.0;     // 1.0 = one triad per source pixel
uniform float GlowAmount = 0.30;   // halation
uniform float Curvature = 0.10;
uniform float BeamWidth = 0.50;    // bright fraction of a line; the rest is gap
uniform float Vignette = 0.20;
uniform float Sharpness = 0.25;

// Stripe edge width in stripe units, shared by the pattern and by the divisor
// that restores the picture's average brightness.
#define MASK_SOFT 0.35

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

// Pass 0: the halation source. Two scales of blur in one pass, 9 taps, because
// halation is entirely low-frequency: what matters is that light spreads a few
// source pixels, not the exact kernel. The 5x5 this replaced was more expensive
// AND narrower.
float4 GlowPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 px = float2(1.0 / BUFFER_WIDTH, 1.0 / BUFFER_HEIGHT);
    float3 sum = tex2D(BackBuffer, texcoord).rgb * 0.34;
    // Tight ring: 4 taps at 3 output pixels, which softens the beam itself.
    sum += (tex2D(BackBuffer, texcoord + float2(px.x, 0.0) * 3.0).rgb
          + tex2D(BackBuffer, texcoord - float2(px.x, 0.0) * 3.0).rgb
          + tex2D(BackBuffer, texcoord + float2(0.0, px.y) * 3.0).rgb
          + tex2D(BackBuffer, texcoord - float2(0.0, px.y) * 3.0).rgb) * 0.12;
    // Wide ring: 4 taps at 9 output pixels, so the halo reaches past the
    // scanline structure instead of only fattening the line it sits on.
    sum += (tex2D(BackBuffer, texcoord + float2(px.x, 0.0) * 9.0).rgb
          + tex2D(BackBuffer, texcoord - float2(px.x, 0.0) * 9.0).rgb
          + tex2D(BackBuffer, texcoord + float2(0.0, px.y) * 9.0).rgb
          + tex2D(BackBuffer, texcoord - float2(0.0, px.y) * 9.0).rgb) * 0.045;
    return float4(sum, 1.0);
}

// Pass 1: the tube.
float4 CRTPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 uv = CrtWarp(texcoord, Curvature);
    float inside = CrtInside(uv);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));
    float2 pixel = clamped * float2(BUFFER_WIDTH, BUFFER_HEIGHT);

    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 so = float2(pitch / BUFFER_WIDTH, pitch / BUFFER_HEIGHT);

    // Chroma deconvergence: a quarter of a source pixel of radial fringing at
    // the edges and none in the centre, the way a tube's three guns never line
    // up perfectly. Radial, not a flat shift, so text stays clean mid-screen.
    float2 rad = (clamped - 0.5) * so * 0.5;
    float3 sharp = float3(tex2D(BackBuffer, clamped + rad).r,
                          tex2D(BackBuffer, clamped).g,
                          tex2D(BackBuffer, clamped - rad).b);
    float3 glow = tex2D(SamplerA, clamped).rgb;

    // Unsharp mask, so the softening can be dialled back instead of guessed at.
    // The radius is one source pixel, so the control means the same thing at
    // 1080p and at 4K. 4 taps.
    float3 around = (tex2D(BackBuffer, clamped + float2(so.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped - float2(so.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped + float2(0.0, so.y)).rgb
                   + tex2D(BackBuffer, clamped - float2(0.0, so.y)).rgb) * 0.25;
    float3 base = sharp + (sharp - around) * Sharpness;

    // Beam: bright across the middle of a source line, dark at the boundary.
    float gap = 1.0 - min(max(BeamWidth, 0.05), 0.95);
    float beam = CrtBeam(CrtLineEdge(clamped.y, SourceLines), gap);
    float3 color = base * ((1.0 - ScanIntensity * (1.0 - beam))
                           / CrtScanMean(ScanIntensity, gap));

    // Halation fills the gaps rather than hazing the whole picture: it is
    // scaled by the gap itself, so it tracks the scanlines. GlowAmount is
    // deliberately independent of ScanIntensity — turning the lines off must
    // not take the halo with them.
    color += glow * GlowAmount * (1.0 - beam);

    // Aperture grille: one triad per source pixel, MaskScale times that. Triads
    // at the 4K output pitch are invisible from the couch and beat against the
    // panel; source-pixel triads are what reads as a mask. Stagger 0 keeps the
    // stripes unbroken.
    float mp = CrtMaskPitch(SourceLines, MaskScale);
    color = CrtMask(color, CrtMaskPattern(pixel, mp, MASK_SOFT, 0.0, mp),
                    MaskStrength);
    color /= CrtMaskMean(MaskStrength, MASK_SOFT);

    // Vignette, strongest in the corners.
    float2 cc = clamped - 0.5;
    color *= 1.0 - Vignette * dot(cc, cc) * 1.2;

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass Pass0
    {
        RenderTarget = BufferA;
        VertexShader = PostProcessVS;
        PixelShader = GlowPS;
    }
    pass Pass1
    {
        VertexShader = PostProcessVS;
        PixelShader = CRTPS;
    }
}

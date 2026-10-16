// DeckyCRT :: CRT Pro — the flagship, three passes
//
// Pass 0 bright-passes the frame and blurs it horizontally, pass 1 blurs that
// vertically, pass 2 is the tube: geometry, beam, mask, halation, corners,
// display trims.
//
// The option set is the useful half of CRT-Guest-Advanced's, which is the most
// complete CRT shader in the field at 129 parameters. What was taken, and why:
//
//   beam       Guest exposes beam shape (scanline1/scanline2), and a separate
//              shape for dark and bright pixels (beam_min/beam_max). BeamWidth +
//              BeamSoftness cover the shape; the luminance-dependent part is
//              left out because on a fixed 60 Hz panel it reads as flicker on
//              dark content rather than as beam spread.
//   mask       Guest's shadow_msk has 14 layouts. Three are worth a slider:
//              grille (unbroken stripes), slot (staggered), dot (staggered and
//              softer). Its mask_gamma/mask_drk/mask_lgt collapse to MaskGamma.
//   glow       Guest separates glow from bloom/halation and gives each its own
//              H and V radius and sigma (SIZEH/SIZEV/SIGMA_H/SIGMA_V). That
//              separation is the single biggest reason it looks better than a
//              ring blur, so it is kept: GlowX/GlowY are real radii, and the
//              gaussian is separable (a true horizontal pass, then a vertical
//              one) instead of a sampled ring.
//   trims      Gamma input/output, black level, saturation, colour temperature.
//              Guest's CRT-profile LUTs (P22, SMPTE-C, Trinitron) need 3D LUT
//              textures and are not reproducible here.
//   NOT taken  Persistence/afterglow (needs the previous frame, which Gamescope
//              does not hand a pass), interlacing and rolling scan (a strobe on
//              a 60 Hz panel), hum bars, TATE, integer scaling, noise.
//
// Written for Gamescope's reshadefx, a subset of ReShade FX. Every idiom here
// was proven to compile on gamescope 3.16.31-ogc2+:
//   - no fmod (use frac)
//   - no scalar vector splats (float3(1.0) is rejected; write all three)
//   - no implicit vector truncation (X3206 is fatal here)
//   - pixel shader parameters match the vertex shader semantics exactly
//   - no annotations on uniforms; the plugin declares the sliders
//
// The raster geometry lives in crt-common.fxh and scales off SourceLines rather
// than off the output grid.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

// The glow chain runs at HALF RESOLUTION. Halation is entirely low-frequency, so
// half-res costs nothing visible, and it makes a separable blur cheaper than the
// single full-res ring it replaces: 18 taps over a quarter of the pixels against
// 9 over all of them. No semantic on these, or Gamescope creates nothing and a
// missing intermediate silently falls back to the sharp frame instead of
// failing loudly.
texture BufferA { Width = BUFFER_WIDTH / 2; Height = BUFFER_HEIGHT / 2; Format = RGBA8; };
sampler SamplerA { Texture = BufferA; };
texture BufferB { Width = BUFFER_WIDTH / 2; Height = BUFFER_HEIGHT / 2; Format = RGBA8; };
sampler SamplerB { Texture = BufferB; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.35;
uniform float BeamWidth = 0.50;
uniform float BeamSoftness = 1.00;
uniform float MaskType = 1.0;
uniform float MaskStrength = 0.18;
uniform float MaskScale = 1.0;
uniform float MaskGamma = 1.0;
uniform float GlowAmount = 0.30;
uniform float GlowX = 3.0;
uniform float GlowY = 3.0;
uniform float GlowThreshold = 0.0;
uniform float Sharpness = 0.25;
uniform float Convergence = 0.50;
uniform float CurvatureX = 0.10;
uniform float CurvatureY = 0.10;
uniform float Vignette = 0.20;
uniform float CornerSize = 0.0;
uniform float Overscan = 0.0;
uniform float Brightness = 1.00;
uniform float Gamma = 1.0;
uniform float BlackLevel = 0.0;
uniform float Saturation = 1.0;
uniform float ColorTemp = 0.5;

// Taps per side of the gaussian. 4 each side is 9 samples over the radius,
// which is plenty for a signal that is by definition blurry.
#define GLOW_TAPS 4

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

// Weighted by its own brightness, so the halo comes from what is actually
// bright. Without the weight the glow is a flat haze over the whole picture and
// everything looks washed out, which is the most common way a CRT shader is
// "wrong" and the hardest to attribute.
float3 BrightPass(float2 uv)
{
    float3 c = tex2D(BackBuffer, uv).rgb;
    float luma = dot(c, float3(0.299, 0.587, 0.114));
    float w = saturate((luma - GlowThreshold) / max(1.0 - GlowThreshold, 0.01));
    return c * w;
}

// Horizontal pass. The radius is in SOURCE pixels, so the halo keeps its
// physical size when the scanline count or the output resolution changes.
float4 GlowHPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float src = BUFFER_HEIGHT / max(SourceLines, 1.0);
    float r = max(GlowX, 0.0) * src / BUFFER_WIDTH;
    float3 sum = float3(0.0, 0.0, 0.0);
    float wsum = 0.0;
    int i;
    for (i = -GLOW_TAPS; i <= GLOW_TAPS; i++)
    {
        float o = float(i) * 0.25;
        float w = exp(-o * o * 1.8);
        sum += BrightPass(texcoord + float2(o * r, 0.0)) * w;
        wsum += w;
    }
    return float4(sum / wsum, 1.0);
}

// Vertical pass: this is the one that fills the scanline gaps, so it is
// deliberately separable from the horizontal bleed rather than one isotropic
// blur.
float4 GlowVPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float src = BUFFER_HEIGHT / max(SourceLines, 1.0);
    float r = max(GlowY, 0.0) * src / BUFFER_HEIGHT;
    float3 sum = float3(0.0, 0.0, 0.0);
    float wsum = 0.0;
    int i;
    for (i = -GLOW_TAPS; i <= GLOW_TAPS; i++)
    {
        float o = float(i) * 0.25;
        float w = exp(-o * o * 1.8);
        sum += tex2D(SamplerA, texcoord + float2(0.0, o * r)).rgb * w;
        wsum += w;
    }
    return float4(sum / wsum, 1.0);
}

// Pass 2: the tube.
float4 CRTPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    // ---- screen geometry. Curvature is per-axis: a real tube is not equally
    // curved both ways. Overscan zooms in to push the warped corners off-screen,
    // which is what a set's overscan actually did.
    float2 uv = CrtWarp2(texcoord, float2(CurvatureX, CurvatureY));
    uv = (uv - 0.5) * (1.0 - 2.0 * saturate(Overscan)) + 0.5;
    float inside = CrtInside(uv);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));

    float src = BUFFER_HEIGHT / max(SourceLines, 1.0);
    float2 so = float2(src / BUFFER_WIDTH, src / BUFFER_HEIGHT);

    // ---- convergence: R and B pulled apart radially at the edges and aligned
    // in the centre, the way a tube's three guns never quite agree.
    float2 rad = (clamped - 0.5) * so * max(Convergence, 0.0);
    float3 sharp = float3(tex2D(BackBuffer, clamped + rad).r,
                          tex2D(BackBuffer, clamped).g,
                          tex2D(BackBuffer, clamped - rad).b);

    // ---- sharpness: unsharp at one SOURCE pixel, so the control means the same
    // thing at 1080p and at 4K. 4 taps of the sharp frame.
    float3 around = (tex2D(BackBuffer, clamped + float2(so.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped - float2(so.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped + float2(0.0, so.y)).rgb
                   + tex2D(BackBuffer, clamped - float2(0.0, so.y)).rgb) * 0.25;
    float3 base = sharp + (sharp - around) * Sharpness;

    // ---- beam. The line pattern is locked to the SCREEN, not to the warped
    // image: the mask and the scanlines are part of the glass, and keeping them
    // on the screen grid stops curvature from skewing their pitch.
    float gap = 1.0 - min(max(BeamWidth, 0.05), 0.99);
    float power = min(max(BeamSoftness, 0.2), 6.0);
    float ramp = saturate(CrtLineEdge(texcoord.y, SourceLines) / max(gap, 0.001));
    float beam = pow(ramp, power);
    float3 color = base * ((1.0 - ScanIntensity * (1.0 - beam))
                           / CrtScanMeanPow(ScanIntensity, gap, power));

    // ---- halation fills the gaps rather than hazing the picture: scaled by the
    // gap, so it tracks the beam. GlowAmount is deliberately independent of
    // ScanIntensity, so turning the lines off keeps the halo.
    float3 glow = tex2D(SamplerB, clamped).rgb;
    color += glow * GlowAmount * (1.0 - beam);

    // ---- mask.
    float mp = CrtMaskPitch(SourceLines, MaskScale);
    float msoft = (MaskType > 2.5) ? 0.50 : 0.35;
    float stagger = (MaskType > 1.5) ? 0.5 : 0.0;
    float3 lit = float3(1.0, 1.0, 1.0);
    if (MaskType >= 0.5)
    {
        lit = CrtMaskPattern(texcoord * float2(BUFFER_WIDTH, BUFFER_HEIGHT),
                             mp, msoft, stagger, mp);
        lit = pow(max(lit, float3(0.0, 0.0, 0.0)), MaskGamma);
    }
    // With the mask off the divisor must be 1, or "no mask" would brighten the
    // picture by the amount the mask would have dimmed it.
    float mmean = (MaskType >= 0.5) ? CrtMaskMean(MaskStrength, msoft) : 1.0;
    color = CrtMask(color, lit, MaskStrength) / mmean;

    // ---- corners and vignette.
    float corner = 1.0;
    if (CornerSize > 0.001)
    {
        float2 q = abs(clamped - 0.5) - (0.5 - CornerSize);
        float d = length(max(q, float2(0.0, 0.0))) - CornerSize;
        corner = 1.0 - smoothstep(-0.02, 0.02, d);
    }
    float2 cc = clamped - 0.5;
    color *= corner * (1.0 - Vignette * dot(cc, cc) * 1.2);

    // ---- display trims, after the raster so they mean what they say.
    color *= Brightness;
    // A monotone lift/crush: positive raises the black level and compresses the
    // top, negative crushes the floor and stretches the highlights.
    color = saturate(BlackLevel + color * (1.0 - BlackLevel));
    color = pow(max(color, float3(0.0, 0.0, 0.0)), 1.0 / max(Gamma, 0.05));
    float luma = dot(color, float3(0.299, 0.587, 0.114));
    color = lerp(float3(luma, luma, luma), color, Saturation);
    // Neutral at 0.5; the endpoints are the tube-era warm/cool ends.
    color *= lerp(float3(0.94, 1.00, 1.06), float3(1.06, 1.00, 0.94), ColorTemp);
    color = saturate(color);

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass Pass0
    {
        RenderTarget = BufferA;
        VertexShader = PostProcessVS;
        PixelShader = GlowHPS;
    }
    pass Pass1
    {
        RenderTarget = BufferB;
        VertexShader = PostProcessVS;
        PixelShader = GlowVPS;
    }
    pass Pass2
    {
        VertexShader = PostProcessVS;
        PixelShader = CRTPS;
    }
}

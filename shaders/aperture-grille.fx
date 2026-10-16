// DeckyCRT :: Aperture grille
// Trinitron-style unbroken RGB stripes plus scanlines, flat screen, single pass.
//
// The raster comes from crt-common.fxh. Both patterns scale off SourceLines:
// one scanline per source line, one triad per source pixel. The old version
// drew its triad at three OUTPUT columns, which on a 4K panel is the panel's
// own stripe pitch — it beat against it and read as shimmer rather than as a
// mask.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.35;
uniform float MaskStrength = 0.18;

#define BEAM_GAP 0.55

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.35

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 AperturePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

    // Stagger 0 keeps the stripes unbroken, which is the whole point of a
    // grille over a slot mask.
    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = texcoord * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    color = CrtMask(color, CrtMaskPattern(pixel, pitch, MASK_SOFT, 0.0, pitch),
                    MaskStrength);
    color /= CrtMaskMean(MaskStrength, MASK_SOFT);

    float beam = CrtBeam(CrtLineEdge(texcoord.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = AperturePS;
    }
}

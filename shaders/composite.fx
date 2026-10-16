// DeckyCRT :: Composite
// NTSC-ish colour bleed: sharp luma, smeared chroma, source-locked scanlines.
//
// The bleed offset used to be two OUTPUT pixels, i.e. a sub-millimetre smear at
// 4K — nothing at all. Chroma is smeared by one SOURCE pixel here, which is
// what an NTSC decoder actually does and why it is visible.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.35;
uniform float Bleed = 0.60;

#define BEAM_GAP 0.50

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.35

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 CompositePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    // One source pixel of chroma smear, in UV.
    float src = max(BUFFER_HEIGHT / max(SourceLines, 1.0), 8.0);
    float2 sx = float2(src / BUFFER_WIDTH, 0.0);
    float3 s0 = tex2D(BackBuffer, texcoord).rgb;
    float3 sL = tex2D(BackBuffer, texcoord - sx).rgb;
    float3 sR = tex2D(BackBuffer, texcoord + sx).rgb;

    // Luma stays sharp, chroma gets smeared horizontally.
    float luma = dot(s0, float3(0.299, 0.587, 0.114));
    float3 soft = (sL + s0 + sR) / 3.0;
    float3 chroma = soft - dot(soft, float3(0.299, 0.587, 0.114));
    float3 color = luma + chroma * (1.0 - Bleed * 0.85);

    // Faint fixed grille so it still reads as a tube.
    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = texcoord * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    color = CrtMask(color, CrtMaskPattern(pixel, pitch, MASK_SOFT, 0.0, pitch), 0.15);
    color /= CrtMaskMean(0.15, MASK_SOFT);

    float beam = CrtBeam(CrtLineEdge(texcoord.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = CompositePS;
    }
}

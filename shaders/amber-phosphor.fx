// DeckyCRT :: Amber phosphor
// Monochrome amber terminal tube with halation glow. Single pass.
//
// Shares crt-common.fxh with the green phosphor; only the tint and the bloom
// colour are different.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.45;
uniform float MaskStrength = 0.15;
uniform float Glow = 0.35;

#define BEAM_GAP 0.50

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.50

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 AmberPhosphorPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 rgb = tex2D(BackBuffer, texcoord).rgb;
    float luma = dot(rgb, float3(0.299, 0.587, 0.114));

    // Amber phosphor.
    float3 color = luma * float3(1.00, 0.62, 0.15);
    // Halation: bright areas bloom warm.
    color += Glow * luma * luma * float3(0.45, 0.25, 0.05);

    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = texcoord * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    float stripe = CrtGrille(pixel.x, pitch, MASK_SOFT).r;
    color = CrtMask(color, float3(stripe, stripe, stripe), MaskStrength);
    color /= CrtMaskMean(MaskStrength, MASK_SOFT);

    float beam = CrtBeam(CrtLineEdge(texcoord.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    // Gentle vignette.
    float2 cc = texcoord - 0.5;
    color *= 1.0 - dot(cc, cc) * 0.45;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = AmberPhosphorPS;
    }
}

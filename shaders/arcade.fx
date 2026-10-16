// DeckyCRT :: Arcade
// Cabinet monitor: heavy staggered slot mask, strong scanlines, curve.
//
// An arcade monitor ran 224-240 lines at 15 kHz, so SourceLines defaults to 224
// and the beam is crisp. The "slot gap" row structure used to be one OUTPUT row
// in three, i.e. 720 dark rows at 4K; it is one SOURCE row in three here.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 224;
uniform float ScanIntensity = 0.50;
uniform float MaskStrength = 0.25;
uniform float Curvature = 0.14;

#define BEAM_GAP 0.45

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.35

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ArcadePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 uv = CrtWarp(texcoord, Curvature);
    float inside = CrtInside(uv);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));

    float3 color = tex2D(BackBuffer, clamped).rgb;

    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = clamped * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    color = CrtMask(color, CrtMaskPattern(pixel, pitch, MASK_SOFT, 0.5, pitch),
                    MaskStrength);
    color /= CrtMaskMean(MaskStrength, MASK_SOFT);

    // Slot gaps: every third SOURCE row slightly darker.
    float row = floor(clamped.y * max(SourceLines, 1.0));
    color *= ((frac(row / 3.0) * 3.0) < 2.0) ? 1.0 : 0.88;

    float beam = CrtBeam(CrtLineEdge(clamped.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    float2 cc = clamped - 0.5;
    color *= 1.0 - dot(cc, cc) * 0.55;

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = ArcadePS;
    }
}

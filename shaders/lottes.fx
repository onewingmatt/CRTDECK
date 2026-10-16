// DeckyCRT :: Lottes
// Lottes-inspired: curved screen, aperture grille, soft wide scanlines and a
// rounded-corner mask. Single pass.
//
// The softness is the point of this preset — gap 0.80 is a very wide beam — so
// it sits at the opposite end of the family from the PVM. What it did NOT have
// is Lottes's defining trick: a mask scaled to the source pixel. It does now.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.40;
uniform float MaskStrength = 0.22;
uniform float Curvature = 0.12;

#define BEAM_GAP 0.80

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.40

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 LottesPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    // Lottes warps harder than the other curved presets at the same number.
    float2 uv = CrtWarp(texcoord, Curvature * 1.5);
    float inside = CrtInside(uv);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));

    float3 color = tex2D(BackBuffer, clamped).rgb;

    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = clamped * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    color = CrtMask(color, CrtMaskPattern(pixel, pitch, MASK_SOFT, 0.0, pitch),
                    MaskStrength);
    color /= CrtMaskMean(MaskStrength, MASK_SOFT);

    float beam = CrtBeam(CrtLineEdge(clamped.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    // Rounded-corner mask: fade to black near the extreme corners.
    float2 cc = texcoord - 0.5;
    color *= smoothstep(0.52, 0.38, dot(cc, cc));

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = LottesPS;
    }
}

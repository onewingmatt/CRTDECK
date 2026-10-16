// DeckyCRT :: Shadow mask
// Dot-triad shadow mask, CGA/EGA-era vibe: staggered rows, rounder dots than
// the slot mask. Single pass.
//
// The raster comes from crt-common.fxh. The old version drew its dots at three
// OUTPUT columns, i.e. at the panel's own stripe pitch, where they aliased
// instead of reading as a mask.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.30;
uniform float MaskStrength = 0.22;

#define BEAM_GAP 0.45

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.50

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ShadowMaskPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

    // soft 0.5 makes the stripes meet, so the mask reads as dots separated at
    // the row boundary rather than as hard-edged bars.
    float pitch = CrtMaskPitch(SourceLines, 1.0);
    float2 pixel = texcoord * float2(BUFFER_WIDTH, BUFFER_HEIGHT);
    color = CrtMask(color, CrtMaskPattern(pixel, pitch, MASK_SOFT, 0.5, pitch),
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
        PixelShader = ShadowMaskPS;
    }
}

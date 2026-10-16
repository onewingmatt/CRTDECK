// DeckyCRT :: PVM
// Broadcast monitor: sharp image, fine punchy grille, strong scanlines, flat
// screen. Single pass.
//
// A PVM is a 480-line monitor, so the default SourceLines is 480 and the beam
// is crisp (gap 0.35). The mask pitch is floored in crt-common.fxh, because one
// triad per 480-line source pixel would be 4.5 output pixels at 4K — narrow
// enough to alias.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 480;
uniform float ScanIntensity = 0.50;
uniform float MaskStrength = 0.25;

#define BEAM_GAP 0.35

// Stripe edge width in stripe units, shared by the pattern and by the
// divisor that restores the picture's average brightness.
#define MASK_SOFT 0.30

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 PVMPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

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
        PixelShader = PVMPS;
    }
}

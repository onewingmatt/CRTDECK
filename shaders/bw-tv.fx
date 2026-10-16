// DeckyCRT :: B&W TV
// Grayscale tube: luma only, source-locked scanlines, vignette. Single pass.
//
// No mask on this one, on purpose: a monochrome set has no RGB triad structure
// to emulate, and the old faint stripe pattern was at output-pixel pitch, i.e.
// invisible at 4K and aliasing against the panel where it was not.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.40;
uniform float Vignette = 0.50;

#define BEAM_GAP 0.50

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 BWTVPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 rgb = tex2D(BackBuffer, texcoord).rgb;
    float luma = dot(rgb, float3(0.299, 0.587, 0.114));
    float3 color = float3(luma, luma, luma);

    float beam = CrtBeam(CrtLineEdge(texcoord.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    float2 cc = texcoord - 0.5;
    color *= 1.0 - dot(cc, cc) * Vignette;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = BWTVPS;
    }
}

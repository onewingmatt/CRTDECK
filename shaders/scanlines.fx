// DeckyCRT :: Scanlines
// Dark scanlines over the whole frame, one per source line. Single pass.
//
// The raster comes from crt-common.fxh and scales off SourceLines, not off the
// output grid: at 3840x2160 a line every two OUTPUT rows is 1080 dark rows
// across the picture, which the eye averages into a flat grey veil instead of
// resolving as scanlines.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

// How many scanlines the emulated tube had: 240 for a 15 kHz TV, 224 for an
// arcade monitor, 272 like the PPSSPP CRT shader, 480 for a PVM.
uniform float SourceLines = 240;
uniform float ScanIntensity = 0.40;

// Fraction of a line spent ramping between the dark boundary and full beam.
// Fixed per preset: it is the difference between a crisp monitor and a soft
// consumer set, not something the panel needs a slider for.
#define BEAM_GAP 0.50

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ScanlinePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

    float beam = CrtBeam(CrtLineEdge(texcoord.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = ScanlinePS;
    }
}

// DeckyCRT :: Consumer TV
// The crappy childhood RF set: colour bleed, soft image, curve, vignette.
//
// The RF softness is one SOURCE pixel wide, not two output pixels — at 4K the
// old smear was invisible, which is why this preset read as "flat picture with
// colour bars" instead of as a cheap TV.

#include "crt-common.fxh"

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float SourceLines = 240;
uniform float ScanIntensity = 0.40;
uniform float Bleed = 0.70;
uniform float Curvature = 0.12;

#define BEAM_GAP 0.60

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ConsumerTVPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 uv = CrtWarp(texcoord, Curvature);
    float inside = CrtInside(uv);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));

    // One source pixel of smear, in UV.
    float src = max(BUFFER_HEIGHT / max(SourceLines, 1.0), 8.0);
    float2 sx = float2(src / BUFFER_WIDTH, 0.0);
    float3 s0 = tex2D(BackBuffer, clamped).rgb;
    float3 sL = tex2D(BackBuffer, clamped - sx).rgb;
    float3 sR = tex2D(BackBuffer, clamped + sx).rgb;

    float3 soft = (sL + s0 * 2.0 + sR) / 4.0;
    float luma = dot(soft, float3(0.299, 0.587, 0.114));
    float3 chroma = soft - luma;
    float3 color = luma + chroma * (1.0 - Bleed * 0.85);

    float beam = CrtBeam(CrtLineEdge(clamped.y, SourceLines), BEAM_GAP);
    color *= (1.0 - ScanIntensity * (1.0 - beam)) / CrtScanMean(ScanIntensity, BEAM_GAP);

    float2 cc = clamped - 0.5;
    color *= 1.0 - dot(cc, cc) * 0.60;

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = ConsumerTVPS;
    }
}

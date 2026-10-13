// DeckyCRT :: Composite
// NTSC-ish color bleed: sharp luma, smeared chroma, plus scanlines.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.35;
uniform float Bleed = 0.60;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 CompositePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 px = float2(1.0 / BUFFER_WIDTH, 0.0);
    float3 s0 = tex2D(BackBuffer, texcoord).rgb;
    float3 sL = tex2D(BackBuffer, texcoord - px * 2.0).rgb;
    float3 sR = tex2D(BackBuffer, texcoord + px * 2.0).rgb;

    // Luma stays sharp, chroma gets smeared horizontally.
    float luma = dot(s0, float3(0.299, 0.587, 0.114));
    float3 soft = (sL + s0 + sR) / 3.0;
    float3 chroma = soft - dot(soft, float3(0.299, 0.587, 0.114));
    float3 color = luma + chroma * (1.0 - Bleed * 0.85);

    // Subtle fixed grille so it still reads as a tube.
    float col = floor(texcoord.x * BUFFER_WIDTH);
    float m = fmod(col, 3.0);
    float3 triad = (m < 1.0) ? float3(1.00, 0.55, 0.55)
                 : ((m < 2.0) ? float3(0.55, 1.00, 0.55)
                              : float3(0.55, 0.55, 1.00));
    color *= lerp(float3(1.0), triad * (1.0 / 0.70), 0.22);

    float phase = frac(texcoord.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.35, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    color *= 1.0 + ScanIntensity * 0.25;

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

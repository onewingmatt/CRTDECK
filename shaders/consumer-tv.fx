// DeckyCRT :: Consumer TV
// The crappy childhood RF TV: color bleed, soft image, curve, vignette.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.40;
uniform float Bleed = 0.70;
uniform float Curvature = 0.12;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ConsumerTVPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 cc = texcoord - 0.5;
    float r2 = dot(cc, cc);
    float2 uv = texcoord + cc * r2 * Curvature;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return float4(0.0, 0.0, 0.0, 1.0);

    float2 px = float2(1.0 / BUFFER_WIDTH, 0.0);
    float3 s0 = tex2D(BackBuffer, uv).rgb;
    float3 sL = tex2D(BackBuffer, uv - px * 2.0).rgb;
    float3 sR = tex2D(BackBuffer, uv + px * 2.0).rgb;

    // RF softness: everything gets a little smeared, chroma more so.
    float3 soft = (sL + s0 * 2.0 + sR) / 4.0;
    float luma = dot(soft, float3(0.299, 0.587, 0.114));
    float3 chroma = soft - luma;
    float3 color = luma + chroma * (1.0 - Bleed * 0.85);

    float phase = frac(uv.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.35, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    color *= 1.0 - r2 * 0.60;

    color *= 1.0 + ScanIntensity * 0.20;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = ConsumerTVPS;
    }
}

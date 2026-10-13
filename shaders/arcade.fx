// DeckyCRT :: Arcade
// Arcade cabinet monitor: heavy slot mask, strong scanlines, curve.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.50;
uniform float MaskStrength = 0.50;
uniform float Curvature = 0.14;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 ArcadePS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 cc = texcoord - 0.5;
    float r2 = dot(cc, cc);
    float2 uv = texcoord + cc * r2 * Curvature;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return float4(0.0, 0.0, 0.0, 1.0);

    float3 color = tex2D(BackBuffer, uv).rgb;

    float phase = frac(uv.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.35, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    // Heavy staggered slot mask, plus a horizontal slot structure.
    float row = floor(uv.y * BUFFER_HEIGHT);
    float col = floor(uv.x * BUFFER_WIDTH + fmod(row, 2.0) * 1.5);
    float m = fmod(col, 3.0);
    float3 triad = (m < 1.0) ? float3(1.00, 0.35, 0.35)
                 : ((m < 2.0) ? float3(0.35, 1.00, 0.35)
                              : float3(0.35, 0.35, 1.00));
    float triadAvg = (1.00 + 0.35 + 0.35) / 3.0;
    color *= lerp(float3(1.0), triad * (1.0 / triadAvg), MaskStrength);
    // Slot gaps: every 3rd row slightly darker.
    color *= (fmod(row, 3.0) < 2.0) ? 1.0 : 0.85;

    color *= 1.0 - r2 * 0.55;
    color *= 1.0 + ScanIntensity * 0.30;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = ArcadePS;
    }
}

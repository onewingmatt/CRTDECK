// DeckyCRT :: Lottes
// Lottes-inspired: curved screen, aperture grille, scanlines, soft corners.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.40;
uniform float MaskStrength = 0.35;
uniform float Curvature = 0.12;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 LottesPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    // Lottes-style warp.
    float2 cc = texcoord - 0.5;
    float r2 = dot(cc, cc);
    float2 uv = texcoord + cc * r2 * Curvature * 1.5;
    // Rounded-corner mask: fade to black near the extreme corners.
    float corner = smoothstep(0.52, 0.38, r2);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        return float4(0.0, 0.0, 0.0, 1.0);

    float3 color = tex2D(BackBuffer, uv).rgb;

    // Soft wide scanlines, Lottes-style.
    float phase = frac(uv.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.45, phase) * (1.0 - smoothstep(0.55, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    float col = floor(uv.x * BUFFER_WIDTH);
    float m = (frac(col / 3.0) * 3.0);
    float3 triad = (m < 1.0) ? float3(1.00, 0.45, 0.45)
                 : ((m < 2.0) ? float3(0.45, 1.00, 0.45)
                              : float3(0.45, 0.45, 1.00));
    color *= lerp(float3(1.0, 1.0, 1.0), triad * (1.0 / 0.6333), MaskStrength);

    color *= corner;
    color *= 1.0 + ScanIntensity * 0.30;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = LottesPS;
    }
}

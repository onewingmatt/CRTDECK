// DeckyCRT :: PVM
// Broadcast monitor: sharp image, fine grille, strong scanlines, flat screen.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.50;
uniform float MaskStrength = 0.45;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 PVMPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

    // Tight, strong scanlines.
    float phase = frac(texcoord.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.05, 0.30, phase) * (1.0 - smoothstep(0.70, 0.95, phase));
    color *= 1.0 - ScanIntensity * band;

    // Fine, punchy grille.
    float col = floor(texcoord.x * BUFFER_WIDTH);
    float m = (frac(col / 3.0) * 3.0);
    float3 triad = (m < 1.0) ? float3(1.00, 0.30, 0.30)
                 : ((m < 2.0) ? float3(0.30, 1.00, 0.30)
                              : float3(0.30, 0.30, 1.00));
    float triadAvg = (1.00 + 0.30 + 0.30) / 3.0;
    color *= lerp(float3(1.0, 1.0, 1.0), triad * (1.0 / triadAvg), MaskStrength);

    color *= 1.0 + ScanIntensity * 0.35;

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

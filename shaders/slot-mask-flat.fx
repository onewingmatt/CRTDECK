// DeckyCRT :: Slot mask (flat)
// Shadow-mask slots on a flat tube: no curvature, no vignette.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.35;
uniform float MaskStrength = 0.35;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 SlotFlatPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 color = tex2D(BackBuffer, texcoord).rgb;

    float phase = frac(texcoord.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.35, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    float row = floor(texcoord.y * BUFFER_HEIGHT);
    float col = floor(texcoord.x * BUFFER_WIDTH + fmod(row, 2.0) * 1.5);
    float m = fmod(col, 3.0);
    float3 triad = (m < 1.0) ? float3(1.00, 0.40, 0.40)
                 : ((m < 2.0) ? float3(0.40, 1.00, 0.40)
                              : float3(0.40, 0.40, 1.00));
    color *= lerp(float3(1.0), triad * (1.0 / 0.60), MaskStrength);

    color *= 1.0 + ScanIntensity * 0.30;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = SlotFlatPS;
    }
}

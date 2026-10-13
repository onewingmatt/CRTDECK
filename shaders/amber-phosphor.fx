// DeckyCRT :: Amber phosphor
// Monochrome amber terminal look with halation glow.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

uniform float ScanIntensity = 0.45;
uniform float Glow = 0.35;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

float4 AmberPhosphorPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 rgb = tex2D(BackBuffer, texcoord).rgb;
    float luma = dot(rgb, float3(0.299, 0.587, 0.114));

    // Amber phosphor.
    float3 color = luma * float3(1.00, 0.62, 0.15);
    // Halation: bright areas bloom warm.
    color += Glow * luma * luma * float3(0.45, 0.25, 0.05);

    // Faint vertical grille lines.
    float col = floor(texcoord.x * BUFFER_WIDTH);
    color *= 1.0 - 0.10 * step(1.0, (frac(col / 2.0) * 2.0));

    float phase = frac(texcoord.y * BUFFER_HEIGHT * 0.5);
    float band = smoothstep(0.0, 0.35, phase) * (1.0 - smoothstep(0.65, 1.0, phase));
    color *= 1.0 - ScanIntensity * band;

    // Gentle vignette.
    float2 cc = texcoord - 0.5;
    color *= 1.0 - dot(cc, cc) * 0.45;

    return float4(color, 1.0);
}

technique DeckyCRT
{
    pass
    {
        VertexShader = PostProcessVS;
        PixelShader = AmberPhosphorPS;
    }
}

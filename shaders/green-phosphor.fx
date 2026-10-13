// DeckyCRT :: Green phosphor
// Monochrome P1 green terminal look with halation glow.

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

float4 GreenPhosphorPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float3 rgb = tex2D(BackBuffer, texcoord).rgb;
    float luma = dot(rgb, float3(0.299, 0.587, 0.114));

    // P1 green phosphor.
    float3 color = luma * float3(0.25, 1.00, 0.30);
    // Halation: bright areas bloom green.
    color += Glow * luma * luma * float3(0.10, 0.45, 0.12);

    // Faint vertical grille lines.
    float col = floor(texcoord.x * BUFFER_WIDTH);
    color *= 1.0 - 0.10 * step(1.0, fmod(col, 2.0));

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
        PixelShader = GreenPhosphorPS;
    }
}

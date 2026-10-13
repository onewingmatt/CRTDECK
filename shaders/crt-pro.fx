// DeckyCRT :: CRT Pro — two-pass aperture-grille CRT
//
// Written for Gamescope's reshadefx, which is a subset of ReShade FX. Every
// idiom here was proven to compile on gamescope 3.16.28-ogc3+ by the bundled
// single-pass shaders:
//   - no fmod (use frac)
//   - no scalar vector splats (float3(1.0) is rejected; write all three)
//   - no implicit vector truncation (X3206 is fatal here)
//   - pixel shader parameters match the vertex shader semantics exactly
//   - no annotations on uniforms; the plugin declares the sliders
//
// Pass 0 blurs the frame into an intermediate texture (glow / halation source).
// Pass 1 reads both the sharp frame and the blur and builds the CRT image:
// curvature, beam profile, aperture grille, glow in the scanline gaps, vignette.

texture BackBufferTex : COLOR;
sampler BackBuffer { Texture = BackBufferTex; };

// No semantic on this one: Gamescope only creates a texture for declarations
// without a semantic, and a missing intermediate would silently fall back to
// the sharp frame (killing the glow) rather than failing loudly.
texture BufferA { Width = BUFFER_WIDTH; Height = BUFFER_HEIGHT; Format = RGBA8; };
sampler SamplerA { Texture = BufferA; };

uniform float ScanIntensity = 0.35;
uniform float MaskStrength = 0.25;
uniform float GlowAmount = 0.15;
uniform float Curvature = 0.10;
uniform float BeamWidth = 0.50;
uniform float Vignette = 0.20;
uniform float Sharpness = 0.25;

void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
    texcoord.x = (id == 2) ? 2.0 : 0.0;
    texcoord.y = (id == 1) ? 2.0 : 0.0;
    position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}

// Pass 0: 3x3 box blur, 2px taps. Deliberately cheap — this is only the glow
// source, and a 5x5 version cost too much on the BC-250's APU at 4K.
float4 GlowPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 px = float2(1.0 / BUFFER_WIDTH, 1.0 / BUFFER_HEIGHT);
    float3 sum = float3(0.0, 0.0, 0.0);
    int i;
    int j;
    for (i = -1; i <= 1; i++)
    {
        for (j = -1; j <= 1; j++)
        {
            float2 offset = float2(float(i), float(j)) * px * 2.0;
            sum += tex2D(BackBuffer, texcoord + offset).rgb;
        }
    }
    return float4(sum / 9.0, 1.0);
}

// Pass 1: the CRT itself.
float4 CRTPS(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
    float2 px = float2(1.0 / BUFFER_WIDTH, 1.0 / BUFFER_HEIGHT);

    // Barrel distortion around the centre.
    float2 c = texcoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + Curvature * r2;
    float2 uv = c * 0.5 + 0.5;

    // Outside the tube is black. Step products instead of branches.
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float2 clamped = float2(min(max(uv.x, 0.0), 1.0), min(max(uv.y, 0.0), 1.0));

    float3 sharp = tex2D(BackBuffer, clamped).rgb;
    float3 glow = tex2D(SamplerA, clamped).rgb;

    // Unsharp mask, so the CRT softening can be dialled back rather than
    // guessed at. 4 extra taps of the sharp frame only.
    float3 around = (tex2D(BackBuffer, clamped + float2(px.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped - float2(px.x, 0.0)).rgb
                   + tex2D(BackBuffer, clamped + float2(0.0, px.y)).rgb
                   + tex2D(BackBuffer, clamped - float2(0.0, px.y)).rgb) * 0.25;
    float3 base = sharp + (sharp - around) * Sharpness;

    // Beam profile: one beam per two output rows, soft at the edges.
    float phase = frac(clamped.y * BUFFER_HEIGHT * 0.5);
    float beam = smoothstep(0.0, BeamWidth, phase) * (1.0 - smoothstep(1.0 - BeamWidth, 1.0, phase));
    float scan = 1.0 - ScanIntensity * (1.0 - beam);

    // Aperture grille: RGB triads, one triad per three output columns.
    float col = floor(clamped.x * BUFFER_WIDTH);
    float m = frac(col / 3.0) * 3.0;
    float3 triad = (m < 1.0) ? float3(1.00, 0.40, 0.40)
                 : ((m < 2.0) ? float3(0.40, 1.00, 0.40)
                              : float3(0.40, 0.40, 1.00));
    float3 mask = lerp(float3(1.0, 1.0, 1.0), triad * (1.0 / 0.60), MaskStrength);

    // Sharp image through the mask; the blur fills the scanline gaps (halation).
    float3 color = base * scan;
    color += glow * GlowAmount * (1.0 - scan);
    color *= mask;

    // Compensate the light the mask and beams remove.
    color *= 1.0 + ScanIntensity * 0.30 + MaskStrength * 0.20;

    // Vignette, strongest in the corners.
    float vig = 1.0 - Vignette * r2 * 0.25;
    color *= vig;

    return float4(color * inside, 1.0);
}

technique DeckyCRT
{
    pass Pass0
    {
        RenderTarget = BufferA;
        VertexShader = PostProcessVS;
        PixelShader = GlowPS;
    }
    pass Pass1
    {
        VertexShader = PostProcessVS;
        PixelShader = CRTPS;
    }
}

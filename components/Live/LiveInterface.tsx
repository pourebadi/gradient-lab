import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type, Blob } from '@google/genai';
import { useStore } from '../../store';
import { Mic, MicOff, Camera, VideoOff, X, Loader2, Sparkles, MessageSquare } from 'lucide-react';
import { generateId } from '../../utils';

// --- Encoding/Decoding Helpers ---

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Component ---

export const LiveInterface: React.FC = () => {
  const { isLiveActive, setLiveActive, addLiveTranscription, liveTranscription, updateLayerGradient, layers, selectedIds } = useStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showVideo, setShowVideo] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Tracking cursor for smooth audio playback queue
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const frameIntervalRef = useRef<number | null>(null);

  const updateDesignFunction: FunctionDeclaration = {
    name: 'updateDesign',
    parameters: {
      type: Type.OBJECT,
      description: 'Update the gradient design based on the user request. You should choose appropriate colors and style.',
      properties: {
        prompt: { type: Type.STRING, description: 'Brief description of the mood applied.' },
        colors: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING },
          description: 'A set of 2-5 hex color codes that look great together.'
        },
        type: { type: Type.STRING, enum: ['linear', 'radial', 'conic'], description: 'Type of gradient.' }
      },
      required: ['colors']
    },
  };

  const startSession = async () => {
    setIsConnecting(true);
    try {
      // Fix: Use process.env.API_KEY directly as per guidelines
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: { width: 320, height: 240, frameRate: 15 } 
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Live Session Opened');
            setIsConnecting(false);

            // Audio Input Streaming - Mic to model
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              // Ensure data is sent only after connection resolves
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);

            // Video/Frame Streaming - Canvas to model
            frameIntervalRef.current = window.setInterval(() => {
              if (!showVideo || !videoRef.current || !canvasRef.current) return;
              const canvas = canvasRef.current;
              const video = videoRef.current;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              canvas.toBlob((blob) => {
                if (blob) {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    if (typeof reader.result === 'string') {
                      const base64Data = reader.result.split(',')[1];
                      sessionPromise.then(s => s.sendRealtimeInput({ 
                        media: { data: base64Data, mimeType: 'image/jpeg' } 
                      }));
                    }
                  };
                  reader.readAsDataURL(blob);
                }
              }, 'image/jpeg', 0.5);
            }, 1000);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcription
            if (message.serverContent?.outputTranscription) {
              addLiveTranscription(message.serverContent.outputTranscription.text, 'model');
            } else if (message.serverContent?.inputTranscription) {
              addLiveTranscription(message.serverContent.inputTranscription.text, 'user');
            }

            // Handle Audio Output - Model to Speakers
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              // Scheduling audio chunks for gapless playback
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                outputAudioContextRef.current,
                24000,
                1
              );
              const source = outputAudioContextRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContextRef.current.destination);
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
              source.onended = () => audioSourcesRef.current.delete(source);
            }

            // Handle Interruptions - Clear audio queue
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => {
                try { s.stop(); } catch(e) {}
              });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // Handle Tool Calls (Function Calling)
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'updateDesign') {
                  const args = fc.args as any;
                  const targetId = selectedIds[0] || Object.keys(layers)[0];
                  if (targetId) {
                    const newGradient = {
                        type: args.type || 'linear',
                        stops: args.colors.map((c: string, i: number) => ({
                            id: generateId(),
                            offset: i / (args.colors.length - 1),
                            color: c,
                            opacity: 1
                        })),
                        angle: 135,
                        center: { x: 0.5, y: 0.5 }
                    };
                    updateLayerGradient(targetId, newGradient as any);
                  }
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: [{ id: fc.id, name: fc.name, response: { result: 'ok' } }]
                  }));
                }
              }
            }
          },
          onclose: () => stopSession(),
          onerror: (e) => console.error('Live session error', e),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          tools: [{ functionDeclarations: [updateDesignFunction] }],
          systemInstruction: 'You are the "Architect AI", a creative partner in a design tool. You can see the user and their workspace. You help users design beautiful gradients by talking and updating the design directly via updateDesign function. Be inspiring, concise, and professional.'
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (e) {
      console.error('Failed to start live session', e);
      setIsConnecting(false);
      setLiveActive(false);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) sessionRef.current.close();
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    
    audioContextRef.current = null;
    outputAudioContextRef.current = null;
    sessionRef.current = null;
    
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(t => t.stop());
    
    setLiveActive(false);
    setIsConnecting(false);
  };

  useEffect(() => {
    if (isLiveActive) startSession();
    return () => stopSession();
  }, [isLiveActive]);

  if (!isLiveActive) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-end p-6 pointer-events-none">
      {/* Live Transcript / Bubble */}
      <div className="absolute top-20 right-6 w-80 space-y-2 pointer-events-auto">
         <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto no-scrollbar mask-gradient">
            {liveTranscription.slice(-4).map((t, i) => (
                <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs font-medium shadow-lg backdrop-blur-md border ${
                        t.role === 'user' 
                        ? 'bg-blue-600/20 border-blue-500/30 text-blue-100' 
                        : 'bg-zinc-900/40 border-white/10 text-zinc-100'
                    }`}>
                        {t.text}
                    </div>
                </div>
            ))}
         </div>
      </div>

      {/* Main Live Controller */}
      <div className="flex flex-col items-end gap-4 pointer-events-auto">
        
        {/* Camera Container */}
        <div className="relative group">
            {/* Pulsing Glow */}
            <div className={`absolute -inset-1 rounded-full blur-2xl opacity-40 transition-all duration-1000 ${isConnecting ? 'bg-blue-500 animate-pulse' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`} />
            
            <div className="relative w-32 h-32 rounded-full border-2 border-white/20 overflow-hidden shadow-2xl bg-zinc-900 flex items-center justify-center">
                {!showVideo && <VideoOff className="text-zinc-600" size={32} />}
                <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className={`w-full h-full object-cover grayscale brightness-125 contrast-110 ${!showVideo ? 'hidden' : ''}`} 
                />
                {isConnecting && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white">
                        <Loader2 className="animate-spin mb-1" size={20} />
                        <span className="text-[10px] font-bold uppercase">Syncing</span>
                    </div>
                )}
                {/* Visualizer Overlay */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500/50" />
            </div>

            {/* Float Controls */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex gap-2">
                <button onClick={() => setIsMuted(!isMuted)} className={`p-2 rounded-full border shadow-xl transition-all ${isMuted ? 'bg-red-500 border-red-400 text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                    {isMuted ? <MicOff size={16}/> : <Mic size={16}/>}
                </button>
                <button onClick={() => setShowVideo(!showVideo)} className={`p-2 rounded-full border shadow-xl transition-all ${!showVideo ? 'bg-red-500 border-red-400 text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                    {!showVideo ? <VideoOff size={16}/> : <Camera size={16}/>}
                </button>
                <button onClick={stopSession} className="p-2 rounded-full bg-zinc-900 border border-white/10 text-white hover:bg-zinc-800 shadow-xl">
                    <X size={16}/>
                </button>
            </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">Architect Live</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
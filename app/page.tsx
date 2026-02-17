'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// --- OFFICIAL RGS COLOR MAPPING ---
const CORP_METADATA: Record<string, { color: string, bg: string, text: string }> = {
  Sackson: { color: '#e11d48', bg: 'bg-rose-600', text: 'text-white' },
  Festival: { color: '#16a34a', bg: 'bg-green-600', text: 'text-white' },
  Tower: { color: '#ca8a04', bg: 'bg-yellow-600', text: 'text-white' },
  American: { color: '#2563eb', bg: 'bg-blue-600', text: 'text-white' },
  Worldwide: { color: '#92400e', bg: 'bg-amber-900', text: 'text-white' },
  Imperial: { color: '#9333ea', bg: 'bg-purple-600', text: 'text-white' },
  Continental: { color: '#0891b2', bg: 'bg-cyan-600', text: 'text-white' },
};

const CORPORATIONS = Object.keys(CORP_METADATA);
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// --- TYPES ---
type Message = { player_name: string; content: string; created_at: string };
// (Other types Player and Lobby remain same as previous version)

export default function Home() {
  // --- STATE ---
  const [playerName, setPlayerName] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- REAL-TIME SUBSCRIPTIONS ---
  useEffect(() => {
    if (!lobbyInfo) return;

    const fetchMessages = async () => {
      const { data } = await supabase.from('messages').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (data) setMessages(data);
    };
    fetchMessages();

    const channel = supabase.channel('game-room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `lobby_id=eq.${lobbyInfo.id}` }, 
        (payload) => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [lobbyInfo?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- ACTIONS ---
  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    await supabase.from('messages').insert([{ lobby_id: lobbyInfo.id, player_name: playerName, content: chatInput }]);
    setChatInput('');
  };

  // (Include previous handlePlaceTile, handleBuyStock, handleEndGame etc here)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4">
      {/* HEADER */}
      <div className="max-w-7xl mx-auto flex justify-between items-center mb-6">
        <h1 className="text-2xl font-black tracking-tighter text-amber-500 italic">ACQUIRE SYNDICATE</h1>
        <div className="flex gap-4">
          <button onClick={() => setRulebookOpen(true)} className="text-xs bg-slate-800 px-4 py-2 rounded-full border border-slate-700 hover:bg-slate-700">RULEBOOK</button>
          {lobbyInfo && <span className="text-xs font-mono bg-amber-500/10 text-amber-500 px-4 py-2 rounded-full border border-amber-500/20">Lobby: {lobbyInfo.code}</span>}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT: THE BOARD */}
        <div className="lg:col-span-8 bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-2xl relative overflow-hidden">
          <div className="grid grid-cols-12 gap-1 sm:gap-2">
            {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
              const id = `${c}${r}`;
              const isP = lobbyInfo?.board_state?.includes(id);
              const owner = lobbyInfo?.tile_ownership?.[id];
              const meta = owner ? CORP_METADATA[owner] : null;

              return (
                <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-[10px] font-bold border-2 transition-all duration-500 
                  ${isP ? (owner ? `${meta?.bg} ${meta?.text} border-white shadow-lg scale-95` : 'bg-amber-500 text-black border-amber-400') : 'bg-slate-800/50 text-slate-700 border-slate-800'}`}>
                  {id}
                  {owner && <span className="text-[6px] uppercase opacity-80">{owner.substring(0, 3)}</span>}
                </div>
              );
            }))}
          </div>
        </div>

        {/* RIGHT: CONTROLS & CHAT */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* STATS & CONTROLS */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl">
             {/* Render player list with money and stocks here using the CORP_METADATA colors */}
          </div>

          {/* REAL-TIME CHAT */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 flex flex-col h-[400px] shadow-xl overflow-hidden">
            <div className="p-3 bg-slate-800/50 border-b border-slate-800 text-[10px] font-bold tracking-widest text-slate-400">SYNDICATE COMMS</div>
            <div className="flex-grow overflow-y-auto p-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.player_name === playerName ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] text-slate-500 mb-1">{m.player_name}</span>
                  <div className={`px-3 py-2 rounded-2xl text-sm max-w-[80%] ${m.player_name === playerName ? 'bg-amber-500 text-black rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChatMessage} className="p-3 bg-slate-800/50 border-t border-slate-800 flex gap-2">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." className="flex-grow bg-slate-900 border border-slate-700 rounded-full px-4 py-2 text-sm outline-none focus:border-amber-500" />
              <button type="submit" className="bg-amber-500 text-black w-10 h-10 rounded-full flex items-center justify-center font-bold">»</button>
            </form>
          </div>
        </div>
      </div>

      {/* RULEBOOK MODAL */}
      {rulebookOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-700 max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-3xl p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-black text-amber-500 italic">SYNDICATE PROTOCOLS</h2>
              <button onClick={() => setRulebookOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-6 text-slate-300">
              <section>
                <h3 className="text-white font-bold mb-2">1. OBJECTIVE</h3>
                <p>Become the wealthiest tycoon by founding hotel chains, expanding them, and strategically merging them to collect stock bonuses.</p>
              </section>
              <section>
                <h3 className="text-white font-bold mb-2">2. FOUNDING & SAFE CHAINS</h3>
                <p>Placing two tiles together founds a chain. A chain with <span className="text-emerald-400 font-bold">11 or more tiles</span> is SAFE and cannot be acquired during a merger.</p>
              </section>
              <section>
                <h3 className="text-white font-bold mb-2">3. STOCK PURCHASING</h3>
                <p>You may buy up to 3 stocks per turn, but only in active hotel chains. Prices are determined by the size and tier of the corporation.</p>
              </section>
            </div>
            <button onClick={() => setRulebookOpen(false)} className="w-full mt-8 bg-amber-500 text-black font-black py-4 rounded-xl shadow-lg">ACKNOWLEDGED</button>
          </div>
        </div>
      )}
    </main>
  );
}
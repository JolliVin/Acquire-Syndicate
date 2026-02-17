'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// --- CONSTANTS ---
const CORP_METADATA: Record<string, { bg: string, text: string, border: string }> = {
  Sackson: { bg: 'bg-rose-600', text: 'text-white', border: 'border-rose-400' },
  Festival: { bg: 'bg-green-600', text: 'text-white', border: 'border-green-400' },
  Tower: { bg: 'bg-yellow-500', text: 'text-black', border: 'border-yellow-300' },
  American: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-400' },
  Worldwide: { bg: 'bg-amber-900', text: 'text-white', border: 'border-amber-700' },
  Imperial: { bg: 'bg-purple-600', text: 'text-white', border: 'border-purple-400' },
  Continental: { bg: 'bg-cyan-600', text: 'text-white', border: 'border-cyan-400' },
};

const CORPORATIONS = Object.keys(CORP_METADATA);
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// --- UTILITIES ---
const getTileValue = (tile: string) => {
  const num = parseInt(tile.match(/\d+/)?.[0] || '0');
  const row = tile.match(/[A-I]/)?.[0] || 'A';
  return (row.charCodeAt(0) - 65) * 100 + num;
};

const getStockPrice = (corp: string, size: number) => {
  const s = size < 2 ? 2 : size;
  let base = 0;
  if (['Sackson', 'Tower'].includes(corp)) base = 200;
  else if (['Festival', 'Worldwide', 'American'].includes(corp)) base = 300;
  else if (['Imperial', 'Continental'].includes(corp)) base = 400;

  let bonus = 0;
  if (s === 3) bonus = 100; else if (s === 4) bonus = 200; else if (s === 5) bonus = 300;
  else if (s >= 6 && s <= 10) bonus = 400; else if (s >= 11 && s <= 20) bonus = 500;
  else if (s >= 21 && s <= 30) bonus = 600; else if (s >= 31 && s <= 40) bonus = 700;
  else if (s >= 41) bonus = 800;
  return base + bonus;
};

// --- TYPES ---
type Player = { id: string; lobby_id: string; player_name: string; is_host: boolean; money: number; hand: string[]; play_order: number; stocks: Record<string, number>; starting_tile?: string; };
type Lobby = { id: string; join_code: string; status: string; board_state: string[]; turn_phase: string; current_turn_index: number; chain_sizes: Record<string, number>; active_chains: string[]; tile_ownership: Record<string, string | null>; available_stocks: Record<string, number>; tile_pool: string[]; merger_data: any; disposition_turn_index?: number; winner_data: any[]; };
type Message = { player_name: string; content: string; created_at: string; };

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [mobileTab, setMobileTab] = useState<'board' | 'market' | 'chat'>('board');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lobbyInfo) return;
    const fetchData = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      const { data: l } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      const { data: m } = await supabase.from('messages').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (p) setPlayers(p as Player[]);
      if (l) setLobbyInfo(prev => ({ ...prev!, ...l }));
      if (m) setMessages(m);
    };
    fetchData();

    const channel = supabase.channel(`lobby-${lobbyInfo.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, (payload) => setLobbyInfo(c => ({ ...c!, ...payload.new })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `lobby_id=eq.${lobbyInfo.id}` }, (payload) => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lobbyInfo?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // --- ACTIONS ---
  const handleStartGame = async () => {
    if (!lobbyInfo || players.length < 2) return;
    setIsStarting(true);

    let pool: string[] = [];
    for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);

    const drawResults = players.map(p => ({ ...p, draw: pool.pop()! }));
    drawResults.sort((a, b) => getTileValue(a.draw) - getTileValue(b.draw));

    const finalUpdates = drawResults.map((p, index) => ({
      id: p.id,
      lobby_id: lobbyInfo.id,
      player_name: p.player_name,
      is_host: p.is_host,
      money: 6000,
      stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
      starting_tile: p.draw,
      hand: pool.splice(-6),
      play_order: index,
    }));

    await supabase.from('players').upsert(finalUpdates);
    await supabase.from('lobbies').update({
      status: 'playing',
      board_state: finalUpdates.map(u => u.starting_tile),
      tile_pool: pool,
      turn_phase: 'place_tile',
      current_turn_index: 0,
      active_chains: [],
      chain_sizes: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}),
      tile_ownership: finalUpdates.reduce((acc, u) => ({ ...acc, [u.starting_tile]: null }), {}),
    }).eq('id', lobbyInfo.id);

    setIsStarting(false);
  };

  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !cur || cur.player_name !== playerName) return;
    
    const getNeighbors = (t: string) => {
        const c = parseInt(t.match(/\d+/)?.[0] || '0');
        const r = BOARD_ROWS.indexOf(t.match(/[A-I]/)?.[0] || 'A');
        const n = [];
        if (c > 1) n.push(`${c-1}${BOARD_ROWS[r]}`); if (c < 12) n.push(`${c+1}${BOARD_ROWS[r]}`);
        if (r > 0) n.push(`${c}${BOARD_ROWS[r-1]}`); if (r < 8) n.push(`${c}${BOARD_ROWS[r+1]}`);
        return n;
    };

    const adj = getNeighbors(tile).filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    if (corps.filter(c => (lobbyInfo.chain_sizes[c] || 0) >= 11).length > 1) return alert("Illegal Move!");

    let next = 'buy_stocks'; let mergerData = {};
    if (corps.length > 1) {
      next = 'merger_resolution';
      const sorted = [...corps].sort((a,b) => lobbyInfo.chain_sizes[b] - lobbyInfo.chain_sizes[a]);
      const tied = sorted.filter(c => lobbyInfo.chain_sizes[c] === lobbyInfo.chain_sizes[sorted[0]]);
      mergerData = { defunct_corps: corps, potential_survivors: tied, tile_placed: tile, is_tied: tied.length > 1 };
      // Survivor auto-selection and bonus logic would go here
    } else if (corps.length === 0 && adj.length > 0) next = 'found_chain';

    await supabase.from('players').update({ hand: cur.hand.filter(t => t !== tile) }).eq('id', cur.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next, merger_data: mergerData, disposition_turn_index: lobbyInfo.current_turn_index }).eq('id', lobbyInfo.id);
  };

  const handleEndTurn = async () => {
    const cur = players.find(p => p.play_order === lobbyInfo!.current_turn_index);
    if (!cur) return;
    const pool = [...lobbyInfo!.tile_pool]; const hand = [...cur.hand];
    if (pool.length > 0) hand.push(pool.pop()!);
    setStocksBoughtThisTurn(0);
    await supabase.from('players').update({ hand }).eq('id', cur.id);
    await supabase.from('lobbies').update({ tile_pool: pool, current_turn_index: (lobbyInfo!.current_turn_index + 1) % players.length, turn_phase: 'place_tile' }).eq('id', lobbyInfo!.id);
  };

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault(); if (!playerName.trim()) return;
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{ name: `${playerName}'s Syndicate`, join_code: code, status: 'waiting', available_stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:25}),{}) }]).select().single();
    if (l) { await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]); setIsHost(true); setLobbyInfo(l as Lobby); }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault(); if (!joinCodeInput.trim()) return;
    const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) { await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: false, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]); setLobbyInfo(l as Lobby); }
  };

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault(); if (!chatInput.trim()) return;
    await supabase.from('messages').insert([{ lobby_id: lobbyInfo!.id, player_name: playerName, content: chatInput }]);
    setChatInput('');
  };

  // --- RENDER ---
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-40">
        <h1 className="text-xl font-black text-amber-500 italic">ACQUIRE SYNDICATE</h1>
        <div className="flex gap-2">
          <button onClick={() => setRulebookOpen(true)} className="text-[10px] bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700 font-bold">PROTOCOL</button>
          {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden relative">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
          
          {/* SETUP SCREENS */}
          {!lobbyInfo && (
            <div className="lg:col-span-12 flex items-center justify-center h-full p-6">
              <div className="max-w-md w-full bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl">
                {view === 'home' && (
                  <div className="flex flex-col gap-4">
                    <button onClick={() => setView('create')} className="bg-amber-500 text-black font-black py-4 rounded-xl">CREATE SYNDICATE</button>
                    <button onClick={() => setView('join')} className="border-2 border-amber-500 text-amber-500 font-black py-4 rounded-xl">INFILTRATE</button>
                  </div>
                )}
                {view === 'create' && (
                  <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
                    <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl outline-none" placeholder="Agent Alias"/>
                    <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">CREATE</button>
                  </form>
                )}
                {view === 'join' && (
                  <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
                    <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl mb-2" placeholder="Agent Alias"/>
                    <input type="text" maxLength={6} required value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-800 p-4 rounded-xl text-center font-mono" placeholder="CODE"/>
                    <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">JOIN</button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* WAITING ROOM */}
          {lobbyInfo && lobbyInfo.status === 'waiting' && (
            <div className="lg:col-span-12 flex flex-col items-center justify-center h-full p-6 text-center">
               <h2 className="text-5xl font-mono font-black text-amber-400 mb-8">{lobbyInfo.join_code}</h2>
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm mb-6">
                  {players.map(p => <div key={p.id} className="py-2 border-b border-slate-800 last:border-0">{p.player_name} {p.is_host && '★'}</div>)}
               </div>
               {isHost && players.length >= 2 && <button onClick={handleStartGame} disabled={isStarting} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black animate-pulse">{isStarting ? 'INITIATING...' : 'INITIATE OPERATION'}</button>}
            </div>
          )}

          {/* PLAYING VIEW */}
          {lobbyInfo && lobbyInfo.status === 'playing' && (
            <>
              <div className={`lg:col-span-8 flex flex-col p-4 lg:p-6 bg-slate-900 lg:rounded-2xl lg:border border-slate-800 overflow-auto ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="min-w-[580px] lg:min-w-0">
                  <div className="grid grid-cols-12 gap-1 sm:gap-2">
                    {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                      const id = `${c}${r}`;
                      const isP = lobbyInfo.board_state.includes(id);
                      const owner = lobbyInfo.tile_ownership[id];
                      const meta = owner ? CORP_METADATA[owner] : null;
                      return (
                        <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-[10px] font-bold border-2 
                          ${isP ? (owner ? `${meta?.bg} ${meta?.text} border-white shadow-lg` : 'bg-amber-500 text-black border-amber-400') : 'bg-slate-800/50 text-slate-700 border-slate-800'}`}>
                          {id}
                        </div>
                      );
                    }))}
                  </div>
                </div>
              </div>

              <div className={`lg:col-span-4 flex flex-col gap-6 p-4 lg:p-0 overflow-y-auto ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
                
                {/* THE OPENING DRAW BOX */}
                <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-2xl shadow-xl">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">The Opening Ceremony</h4>
                  <div className="flex flex-wrap gap-4">
                    {players.sort((a,b) => (a.play_order || 0) - (b.play_order || 0)).map(p => (
                      <div key={p.id} className="flex flex-col items-center">
                        <div className="bg-amber-500 text-black font-mono text-xs px-2 py-1 rounded font-bold shadow-lg border border-amber-300">
                          {p.starting_tile}
                        </div>
                        <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">{p.player_name.substring(0,8)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 shadow-xl">
                   <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Syndicate Leaderboard</h3>
                   {players.map(p => (
                      <div key={p.id} className={`p-4 rounded-2xl border mb-2 ${lobbyInfo.current_turn_index === p.play_order ? 'border-amber-500 bg-slate-800' : 'border-slate-800 bg-slate-900 opacity-60'}`}>
                         <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-sm">{p.player_name}</span>
                            <span className="text-emerald-400 font-mono text-sm">${p.money.toLocaleString()}</span>
                         </div>
                         {p.player_name === playerName && (
                            <div className="flex gap-1 mt-2">{p.hand.map(t => <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== p.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="bg-amber-500 text-black px-2 py-1 rounded font-mono text-[10px] font-bold">{t}</button>)}</div>
                         )}
                      </div>
                   ))}
                   {lobbyInfo.current_turn_index === players.find(p=>p.player_name===playerName)?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && (
                     <button onClick={handleEndTurn} className="w-full mt-4 bg-emerald-600 py-3 rounded-xl font-black text-sm">CONCLUDE TURN</button>
                   )}
                </div>
              </div>

              <div className={`lg:col-span-4 flex flex-col bg-slate-900 lg:rounded-3xl lg:border border-slate-800 h-full shadow-2xl overflow-hidden ${mobileTab !== 'chat' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-4 bg-slate-800/50 border-b border-slate-800 text-[10px] font-black uppercase tracking-widest">Syndicate Comms</div>
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.player_name === playerName ? 'items-end' : 'items-start'}`}>
                      <span className="text-[8px] text-slate-600 mb-1">{m.player_name}</span>
                      <div className={`px-4 py-2 rounded-2xl text-xs ${m.player_name === playerName ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={sendChat} className="p-4 flex gap-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type message..." className="flex-grow bg-slate-800 border border-slate-700 rounded-full px-5 py-2 text-xs outline-none" />
                  <button type="submit" className="bg-amber-500 text-black w-10 h-10 rounded-full font-black">↑</button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      {lobbyInfo && lobbyInfo.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-3 items-center z-50">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}>Board</button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}>Market</button>
          <button onClick={() => setMobileTab('chat')} className={`flex flex-col items-center ${mobileTab === 'chat' ? 'text-amber-500' : 'text-slate-600'}`}>Chat</button>
        </nav>
      )}

      {rulebookOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 max-w-xl w-full rounded-[2rem] p-8">
            <h2 className="text-2xl font-black text-amber-500 italic mb-6">SYNDICATE PROTOCOLS</h2>
            <button onClick={() => setRulebookOpen(false)} className="w-full bg-amber-500 text-black font-black py-4 rounded-2xl">ACKNOWLEDGED</button>
          </div>
        </div>
      )}
    </main>
  );
}
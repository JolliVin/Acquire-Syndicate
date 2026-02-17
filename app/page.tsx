'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// --- OFFICIAL RGS METADATA & CONSTANTS ---
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
  if (s === 3) bonus = 100;
  else if (s === 4) bonus = 200;
  else if (s === 5) bonus = 300;
  else if (s >= 6 && s <= 10) bonus = 400;
  else if (s >= 11 && s <= 20) bonus = 500;
  else if (s >= 21 && s <= 30) bonus = 600;
  else if (s >= 31 && s <= 40) bonus = 700;
  else if (s >= 41) bonus = 800;
  return base + bonus;
};

// --- TYPES ---
type Player = { id: string; player_name: string; is_host: boolean; money: number; hand: string[]; play_order: number; stocks: Record<string, number>; };
type Lobby = { id: string; code: string; status: string; board_state: string[]; turn_phase: string; current_turn_index: number; chain_sizes: Record<string, number>; active_chains: string[]; tile_ownership: Record<string, string | null>; available_stocks: Record<string, number>; tile_pool: string[]; merger_data: any; disposition_turn_index?: number; winner_data: any[]; };
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
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- REAL-TIME SUBSCRIPTIONS ---
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

  // --- GAME LOGIC HELPERS ---
  const getNeighbors = (t: string) => {
    const c = parseInt(t.match(/\d+/)?.[0] || '0');
    const r = BOARD_ROWS.indexOf(t.match(/[A-I]/)?.[0] || 'A');
    const n = [];
    if (c > 1) n.push(`${c-1}${BOARD_ROWS[r]}`); if (c < 12) n.push(`${c+1}${BOARD_ROWS[r]}`);
    if (r > 0) n.push(`${c}${BOARD_ROWS[r-1]}`); if (r < 8) n.push(`${c}${BOARD_ROWS[r+1]}`);
    return n;
  };

  const calculateMergerBonuses = (corp: string, currentPlayers: Player[]) => {
    const price = getStockPrice(corp, lobbyInfo!.chain_sizes[corp]);
    const pBonus = price * 10; const sBonus = price * 5;
    const holders = [...currentPlayers].sort((a, b) => (b.stocks[corp] || 0) - (a.stocks[corp] || 0));
    const top = holders[0]?.stocks[corp] || 0;
    if (top === 0) return [];
    const pList = holders.filter(p => p.stocks[corp] === top);
    if (pList.length > 1) {
      const split = Math.ceil((pBonus + sBonus) / pList.length / 100) * 100;
      return pList.map(p => ({ id: p.id, money: p.money + split }));
    }
    const res = [{ id: pList[0].id, money: pList[0].money + pBonus }];
    const rem = holders.filter(p => p.id !== pList[0].id);
    const sTop = rem[0]?.stocks[corp] || 0;
    if (sTop > 0) {
      const sList = rem.filter(p => p.stocks[corp] === sTop);
      const sSplit = Math.ceil(sBonus / sList.length / 100) * 100;
      sList.forEach(p => res.push({ id: p.id, money: p.money + sSplit }));
    }
    return res;
  };

  // --- ACTIONS ---
  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || cur?.player_name !== playerName) return;
    const adj = getNeighbors(tile).filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    if (corps.filter(c => lobbyInfo.chain_sizes[c] >= 11).length > 1) return alert("Illegal Move!");

    let next = 'buy_stocks'; let mergerData = {};
    if (corps.length > 1) {
      next = 'merger_resolution';
      const sorted = [...corps].sort((a,b) => lobbyInfo.chain_sizes[b] - lobbyInfo.chain_sizes[a]);
      const tied = sorted.filter(c => lobbyInfo.chain_sizes[c] === lobbyInfo.chain_sizes[sorted[0]]);
      mergerData = { defunct_corps: corps, potential_survivors: tied, tile_placed: tile, is_tied: tied.length > 1 };
      if (tied.length === 1) {
        const survivor = tied[0]; const defunct = corps.find(c => c !== survivor)!;
        mergerData = { ...mergerData, survivor, current_defunct: defunct };
        const payouts = calculateMergerBonuses(defunct, players);
        for (const p of payouts) await supabase.from('players').update({ money: p.money }).eq('id', p.id);
      }
    } else if (corps.length === 0 && adj.length > 0) next = 'found_chain';

    await supabase.from('players').update({ hand: cur.hand.filter(t => t !== tile) }).eq('id', cur.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next, merger_data: mergerData, disposition_turn_index: lobbyInfo.current_turn_index }).eq('id', lobbyInfo.id);
  };

  const handleSelectSurvivor = async (survivor: string) => {
    const defunct = lobbyInfo!.merger_data.defunct_corps.find((c:string) => c !== survivor);
    const payouts = calculateMergerBonuses(defunct, players);
    for (const p of payouts) await supabase.from('players').update({ money: p.money }).eq('id', p.id);
    await supabase.from('lobbies').update({ merger_data: { ...lobbyInfo!.merger_data, survivor, current_defunct: defunct, is_tied: false }}).eq('id', lobbyInfo!.id);
  };

  const handleFoundChain = async (corp: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    const last = lobbyInfo!.board_state[lobbyInfo!.board_state.length - 1];
    const tiles = [last, ...getNeighbors(last).filter(n => lobbyInfo!.board_state.includes(n) && !lobbyInfo!.tile_ownership[n])];
    const ownership = { ...lobbyInfo!.tile_ownership }; tiles.forEach(t => ownership[t] = corp);
    await supabase.from('players').update({ money: cur!.money, stocks: { ...cur!.stocks, [corp]: (cur!.stocks[corp] || 0) + 1 }}).eq('id', cur!.id);
    await supabase.from('lobbies').update({ tile_ownership: ownership, active_chains: [...lobbyInfo!.active_chains, corp], chain_sizes: { ...lobbyInfo!.chain_sizes, [corp]: tiles.length }, turn_phase: 'buy_stocks', available_stocks: { ...lobbyInfo!.available_stocks, [corp]: lobbyInfo!.available_stocks[corp] - 1 }}).eq('id', lobbyInfo!.id);
  };

  const handleBuyStock = async (corp: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    const price = getStockPrice(corp, lobbyInfo!.chain_sizes[corp]);
    if (!cur || cur.money < price || stocksBoughtThisTurn >= 3 || lobbyInfo!.available_stocks[corp] <= 0) return;
    setStocksBoughtThisTurn(prev => prev + 1);
    await supabase.from('players').update({ money: cur.money - price, stocks: { ...cur.stocks, [corp]: (cur.stocks[corp] || 0) + 1 }}).eq('id', cur.id);
    await supabase.from('lobbies').update({ available_stocks: { ...lobbyInfo!.available_stocks, [corp]: lobbyInfo!.available_stocks[corp] - 1 }}).eq('id', lobbyInfo!.id);
  };

  const handleDisposition = async (action: 'sell' | 'trade' | 'keep') => {
    const cur = players.find(p => p.play_order === lobbyInfo!.disposition_turn_index);
    const defunct = lobbyInfo!.merger_data.current_defunct; const survivor = lobbyInfo!.merger_data.survivor;
    const count = cur!.stocks[defunct]; let m = cur!.money; let s = { ...cur!.stocks };
    if (action === 'sell') { m += count * getStockPrice(defunct, lobbyInfo!.chain_sizes[defunct]); s[defunct] = 0; }
    else if (action === 'trade') { const pairs = Math.floor(count/2); s[defunct] -= pairs*2; s[survivor] = (s[survivor] || 0) + pairs; }
    
    const nextIdx = (lobbyInfo!.disposition_turn_index! + 1) % players.length;
    if (nextIdx === lobbyInfo!.current_turn_index) {
      const ownership = { ...lobbyInfo!.tile_ownership };
      Object.keys(ownership).forEach(t => { if (ownership[t] === defunct || t === lobbyInfo!.merger_data.tile_placed) ownership[t] = survivor; });
      await supabase.from('lobbies').update({ tile_ownership: ownership, turn_phase: 'buy_stocks', active_chains: lobbyInfo!.active_chains.filter(c => c !== defunct) }).eq('id', lobbyInfo!.id);
    }
    await supabase.from('players').update({ money: m, stocks: s }).eq('id', cur!.id);
    await supabase.from('lobbies').update({ disposition_turn_index: nextIdx }).eq('id', lobbyInfo!.id);
  };

  const handleEndTurn = async () => {
    const cur = players.find(p => p.play_order === lobbyInfo!.current_turn_index);
    const pool = [...lobbyInfo!.tile_pool]; const hand = [...cur!.hand];
    if (pool.length > 0) hand.push(pool.pop()!);
    setStocksBoughtThisTurn(0);
    await supabase.from('players').update({ hand }).eq('id', cur!.id);
    await supabase.from('lobbies').update({ tile_pool: pool, current_turn_index: (lobbyInfo!.current_turn_index + 1) % players.length, turn_phase: 'place_tile' }).eq('id', lobbyInfo!.id);
  };

  const handleEndGame = async () => {
    let standings = players.map(p => {
      let cash = p.money;
      CORPORATIONS.forEach(c => { if (lobbyInfo!.active_chains.includes(c)) cash += p.stocks[c] * getStockPrice(c, lobbyInfo!.chain_sizes[c]); });
      return { ...p, money: cash };
    }).sort((a,b) => b.money - a.money);
    await supabase.from('lobbies').update({ status: 'finished', winner_data: standings }).eq('id', lobbyInfo!.id);
  };

  // --- CHAT & LOBBY SETUP ---
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault(); if (!chatInput.trim()) return;
    await supabase.from('messages').insert([{ lobby_id: lobbyInfo!.id, player_name: playerName, content: chatInput }]);
    setChatInput('');
  };

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault(); const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{ name: `${playerName}'s Syndicate`, join_code: code, available_stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:25}),{}) }]).select().single();
    if (l) { await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]); setIsHost(true); setLobbyInfo(l); }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault(); const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) { await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: false, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]); setLobbyInfo(l); }
  };

  const handleStartGame = async () => {
    let pool: string[] = []; for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);
    const starts = players.map(p => ({ ...p, s: pool.pop()! })).sort((a,b) => getTileValue(a.s) - getTileValue(b.s));
    const updates = starts.map((p, i) => ({ ...p, starting_tile: p.s, hand: pool.splice(-6), play_order: i }));
    await supabase.from('players').upsert(updates);
    await supabase.from('lobbies').update({ status: 'playing', board_state: updates.map(u => u.starting_tile), tile_pool: pool, turn_phase: 'place_tile', active_chains: [], chain_sizes: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), tile_ownership: updates.reduce((a,u)=>({...a,[u.starting_tile]:null}),{}) }).eq('id', lobbyInfo!.id);
  };

  // --- RENDERING ---
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* HEADER */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-40">
        <h1 className="text-xl font-black text-amber-500 italic">ACQUIRE SYNDICATE</h1>
        <div className="flex gap-2">
          <button onClick={() => setRulebookOpen(true)} className="text-[10px] bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700 font-bold">PROTOCOL</button>
          {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden relative">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
          
          {/* VIEW: SETUP (HOME/CREATE/JOIN) */}
          {!lobbyInfo && (
            <div className="lg:col-span-12 flex items-center justify-center h-full p-6">
              <div className="max-w-md w-full bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl">
                {view === 'home' && (
                  <div className="flex flex-col gap-4">
                    <button onClick={() => setView('create')} className="bg-amber-500 text-black font-black py-4 rounded-xl hover:bg-amber-400 transition-all">ESTABLISH NEW SYNDICATE</button>
                    <button onClick={() => setView('join')} className="border-2 border-amber-500 text-amber-500 font-black py-4 rounded-xl hover:bg-slate-800 transition-all">INFILTRATE SYNDICATE</button>
                  </div>
                )}
                {view === 'create' && (
                  <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
                    <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl outline-none focus:ring-2 focus:ring-amber-500" placeholder="Agent Alias"/>
                    <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">CREATE LOBBY</button>
                    <button onClick={() => setView('home')} className="text-xs text-slate-500 text-center">Back</button>
                  </form>
                )}
                {view === 'join' && (
                  <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
                    <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl mb-2" placeholder="Agent Alias"/>
                    <input type="text" maxLength={6} required value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-800 p-4 rounded-xl text-center font-mono tracking-widest" placeholder="XXXXXX"/>
                    <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">JOIN SYNDICATE</button>
                    <button onClick={() => setView('home')} className="text-xs text-slate-500 text-center">Back</button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* VIEW: LOBBY WAITING */}
          {lobbyInfo && lobbyInfo.status === 'waiting' && (
            <div className="lg:col-span-12 flex flex-col items-center justify-center h-full p-6">
               <div className="text-center mb-8">
                  <p className="text-slate-500 text-sm uppercase tracking-widest mb-2">Secure Channel</p>
                  <h2 className="text-5xl font-mono font-black text-amber-400 tracking-tighter">{lobbyInfo.code}</h2>
               </div>
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm mb-6">
                  {players.map(p => <div key={p.id} className="py-2 border-b border-slate-800 last:border-0 flex justify-between"><span>{p.player_name}</span>{p.is_host && <span className="text-amber-500 text-[10px] border border-amber-500 px-2 rounded-full font-bold">HOST</span>}</div>)}
               </div>
               {isHost && <button onClick={handleStartGame} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black animate-pulse shadow-lg shadow-emerald-500/20">INITIATE OPERATION</button>}
            </div>
          )}

          {/* VIEW: PLAYING (GRID/BOARD) */}
          {lobbyInfo && lobbyInfo.status === 'playing' && (
            <>
              <div className={`lg:col-span-8 flex flex-col p-4 lg:p-6 bg-slate-900 lg:rounded-2xl lg:border border-slate-800 overflow-auto ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="relative min-w-[580px] lg:min-w-0">
                  {/* MODALS */}
                  {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500 backdrop-blur-md">
                      <div className="text-center max-w-sm">
                        <h2 className="text-2xl font-black text-amber-400 mb-2">FOUNDATION OPPORTUNITY</h2>
                        <p className="text-xs text-slate-400 mb-6">Select a corporation to establish. You will receive 1 founder's share.</p>
                        <div className="grid grid-cols-2 gap-2">
                          {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                            <button key={corp} onClick={() => handleFoundChain(corp)} className="bg-slate-800 border border-slate-700 p-4 rounded-xl font-bold hover:border-amber-500 transition-all">{corp}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {lobbyInfo.turn_phase === 'merger_resolution' && lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500 backdrop-blur-md">
                      <div className="text-center max-w-sm">
                        <h2 className="text-2xl font-black text-amber-400 mb-2">MERGER TIE-BREAKER</h2>
                        <p className="text-xs text-slate-400 mb-6">Equal sizes detected. Choose the **SURVIVING** corporation.</p>
                        <div className="grid grid-cols-2 gap-2">
                          {lobbyInfo.merger_data.potential_survivors.map((corp:string) => (
                            <button key={corp} onClick={() => handleSelectSurvivor(corp)} className="bg-slate-800 border-2 border-amber-500 p-4 rounded-xl font-black">{corp}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {lobbyInfo.turn_phase === 'merger_resolution' && !lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.disposition_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-emerald-500 backdrop-blur-md">
                      <div className="text-center max-w-sm">
                        <h2 className="text-2xl font-black text-emerald-400 mb-1 tracking-tighter">DISPOSITION PHASE</h2>
                        <p className="text-[10px] text-slate-500 uppercase mb-4">{lobbyInfo.merger_data.current_defunct} → {lobbyInfo.merger_data.survivor}</p>
                        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 mb-4 flex justify-between items-center">
                           <span className="text-xs text-slate-400">Your Shares:</span>
                           <span className="text-xl font-black text-white">{players.find(p => p.player_name === playerName)?.stocks[lobbyInfo.merger_data.current_defunct] || 0}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                           <button onClick={() => handleDisposition('sell')} className="bg-slate-100 text-black font-black py-3 rounded-xl hover:bg-white">SELL ALL SHARES</button>
                           <button onClick={() => handleDisposition('trade')} className="bg-amber-600 text-white font-black py-3 rounded-xl hover:bg-amber-500">TRADE 2-FOR-1</button>
                           <button onClick={() => handleDisposition('keep')} className="bg-slate-800 text-white font-bold py-2 rounded-xl border border-slate-700">KEEP ALL SHARES</button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-12 gap-1 sm:gap-2">
                    {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                      const id = `${c}${r}`;
                      const isP = lobbyInfo.board_state.includes(id);
                      const owner = lobbyInfo.tile_ownership[id];
                      const meta = owner ? CORP_METADATA[owner] : null;
                      const isSafe = owner && (lobbyInfo.chain_sizes[owner] || 0) >= 11;

                      return (
                        <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-[10px] font-bold border-2 transition-all duration-300 
                          ${isP ? (owner ? `${meta?.bg} ${meta?.text} border-white ${isSafe ? 'ring-4 ring-emerald-500/30' : ''} shadow-lg scale-95` : 'bg-amber-500 text-black border-amber-400') : 'bg-slate-800/50 text-slate-700 border-slate-800'}`}>
                          {id}
                        </div>
                      );
                    }))}
                  </div>
                </div>

                {/* MOBILE HAND */}
                <div className="mt-8 lg:hidden border-t border-slate-800 pt-6">
                   <p className="text-[10px] font-black uppercase text-slate-500 mb-3 tracking-widest">Active Inventory (Hand)</p>
                   <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
                      {players.find(p => p.player_name === playerName)?.hand.map(t => (
                        <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== players.find(p=>p.player_name===playerName)?.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="bg-amber-500 text-black px-6 py-3 rounded-2xl font-mono text-sm font-black shadow-xl shadow-amber-500/20 active:scale-90 transition-all disabled:opacity-20">{t}</button>
                      ))}
                   </div>
                </div>
              </div>

              {/* VIEW: MARKET & STATS */}
              <div className={`lg:col-span-4 flex flex-col gap-6 p-4 lg:p-0 overflow-y-auto ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 shadow-xl">
                   <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Syndicate Net Worth</h3>
                      {(lobbyInfo.active_chains.length > 0 && lobbyInfo.active_chains.every(c => lobbyInfo.chain_sizes[c] >= 11)) || Object.values(lobbyInfo.chain_sizes).some(s => s >= 41) ? (
                        <button onClick={handleEndGame} className="text-[9px] bg-red-600 px-2 py-1 rounded-full font-black animate-pulse">LIQUIDATE (END GAME)</button>
                      ) : null}
                   </div>
                   <div className="space-y-3">
                      {players.map(p => (
                         <div key={p.id} className={`p-4 rounded-2xl border transition-all ${lobbyInfo.current_turn_index === p.play_order ? 'border-amber-500 bg-slate-800 scale-105 shadow-lg' : 'border-slate-800 bg-slate-900 opacity-60'}`}>
                            <div className="flex justify-between items-center mb-2">
                               <span className="font-bold text-sm">{p.player_name} {p.player_name === playerName && '(YOU)'}</span>
                               <span className="text-emerald-400 font-mono text-sm">${p.money.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                               {CORPORATIONS.map(c => p.stocks[c] > 0 ? (
                                 <span key={c} className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${CORP_METADATA[c].bg} ${CORP_METADATA[c].text}`}>{c[0]}{p.stocks[c]}</span>
                               ) : null)}
                            </div>
                         </div>
                      ))}
                   </div>
                </div>

                <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 shadow-xl">
                  <div className="flex justify-between items-center mb-4">
                     <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Global Market</h3>
                     <span className="text-[9px] text-slate-600 font-mono">Tiles Left: {lobbyInfo.tile_pool.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                     {CORPORATIONS.map(c => {
                       const size = lobbyInfo.chain_sizes[c] || 0;
                       const active = lobbyInfo.active_chains.includes(c);
                       return (
                         <div key={c} className={`flex items-center justify-between p-3 rounded-2xl border ${active ? 'bg-slate-800 border-slate-700' : 'bg-slate-900 border-slate-800 opacity-30'}`}>
                            <div className="flex items-center gap-3">
                               <div className={`w-3 h-3 rounded-full ${CORP_METADATA[c].bg}`}></div>
                               <span className="text-xs font-bold">{c}</span>
                            </div>
                            <div className="flex items-center gap-4">
                               <div className="text-right">
                                  <div className="text-[10px] font-mono text-amber-500">${getStockPrice(c, size)}</div>
                                  <div className="text-[8px] text-slate-500 uppercase">{size} Tiles</div>
                               </div>
                               <button 
                                 onClick={() => handleBuyStock(c)} 
                                 disabled={!active || stocksBoughtThisTurn >= 3 || lobbyInfo.turn_phase !== 'buy_stocks' || players.find(p=>p.player_name===playerName)?.play_order !== lobbyInfo.current_turn_index}
                                 className="bg-slate-100 text-black text-[10px] font-black px-3 py-1.5 rounded-full disabled:opacity-10 active:scale-90 transition-all"
                               >BUY</button>
                            </div>
                         </div>
                       )
                     })}
                  </div>
                  {lobbyInfo.turn_phase === 'buy_stocks' && players.find(p=>p.player_name===playerName)?.play_order === lobbyInfo.current_turn_index && (
                    <button onClick={handleEndTurn} className="w-full mt-4 bg-emerald-600 py-3 rounded-xl font-black text-sm hover:bg-emerald-500 shadow-lg shadow-emerald-500/10 transition-all">CONCLUDE TURN</button>
                  )}
                </div>
              </div>

              {/* VIEW: CHAT */}
              <div className={`lg:col-span-4 flex flex-col bg-slate-900 lg:rounded-3xl lg:border border-slate-800 h-full shadow-2xl overflow-hidden ${mobileTab !== 'chat' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-4 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                   <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Comms Link</span>
                   <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                </div>
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.player_name === playerName ? 'items-end' : 'items-start'}`}>
                      <span className="text-[8px] text-slate-600 mb-1 font-bold uppercase tracking-tighter">{m.player_name}</span>
                      <div className={`px-4 py-2 rounded-2xl text-xs max-w-[85%] leading-relaxed ${m.player_name === playerName ? 'bg-amber-500 text-black font-medium rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none border border-slate-700'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={sendChat} className="p-4 bg-slate-900 border-t border-slate-800 flex gap-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Send protocol message..." className="flex-grow bg-slate-800 border border-slate-700 rounded-full px-5 py-2.5 text-xs outline-none focus:ring-1 focus:ring-amber-500" />
                  <button type="submit" className="bg-amber-500 text-black w-10 h-10 rounded-full flex items-center justify-center font-black">↑</button>
                </form>
              </div>
            </>
          )}

          {/* VIEW: FINISHED (STANDINGS) */}
          {lobbyInfo && lobbyInfo.status === 'finished' && (
            <div className="lg:col-span-12 flex flex-col items-center justify-center h-full p-6 text-center">
               <h2 className="text-6xl font-black italic text-amber-500 mb-2 tracking-tighter">OPERATION COMPLETE</h2>
               <p className="text-slate-500 text-xs mb-10 tracking-[0.4em] uppercase">Final Liquidation Standings</p>
               <div className="max-w-md w-full space-y-3">
                  {lobbyInfo.winner_data.map((p, i) => (
                    <div key={p.id} className={`flex justify-between items-center p-5 rounded-3xl border-2 transition-all ${i === 0 ? 'bg-amber-500/10 border-amber-500 scale-110 shadow-2xl shadow-amber-500/10' : 'bg-slate-900 border-slate-800 opacity-80'}`}>
                       <div className="flex items-center gap-4">
                          <span className="text-3xl font-black italic text-slate-700">#{i+1}</span>
                          <div className="text-left">
                             <div className="font-black uppercase text-sm">{p.player_name}</div>
                             <div className="text-[10px] text-slate-500">Asset Total</div>
                          </div>
                       </div>
                       <span className="text-xl font-mono font-black text-emerald-400">${p.money.toLocaleString()}</span>
                    </div>
                  ))}
               </div>
               <button onClick={() => window.location.reload()} className="mt-12 text-slate-500 text-[10px] font-bold tracking-widest hover:text-white transition-all">INITIALIZE NEW OPERATION</button>
            </div>
          )}

        </div>
      </div>

      {/* MOBILE NAVIGATION BAR (Bottom Sticky) */}
      {lobbyInfo && lobbyInfo.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-3 items-center z-50">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'board' ? 'text-amber-500 scale-110' : 'text-slate-600'}`}>
            <span className="text-xl">◫</span><span className="text-[9px] font-black tracking-widest uppercase">Board</span>
          </button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'market' ? 'text-amber-500 scale-110' : 'text-slate-600'}`}>
            <span className="text-xl">＄</span><span className="text-[9px] font-black tracking-widest uppercase">Market</span>
          </button>
          <button onClick={() => setMobileTab('chat')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'chat' ? 'text-amber-500 scale-110' : 'text-slate-600'}`}>
            <span className="text-xl">💬</span><span className="text-[9px] font-black tracking-widest uppercase">Comms</span>
          </button>
        </nav>
      )}

      {/* RULEBOOK MODAL */}
      {rulebookOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 max-w-xl w-full max-h-[70vh] overflow-y-auto rounded-[2rem] p-8 shadow-2xl relative">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-amber-500 italic">SYNDICATE PROTOCOLS</h2>
              <button onClick={() => setRulebookOpen(false)} className="text-slate-600 hover:text-white">✕</button>
            </div>
            <div className="space-y-6 text-sm text-slate-400 leading-relaxed">
              <section>
                <h3 className="text-white font-black text-xs uppercase mb-2">I. The Objective</h3>
                <p>Amass the greatest fortune. Establish hotel chains, buy stocks, and initiate mergers to collect massive payouts.</p>
              </section>
              <section>
                <h3 className="text-white font-black text-xs uppercase mb-2">II. Safe Chains</h3>
                <p>A chain with <span className="text-emerald-400 font-bold">11 or more tiles</span> is permanent. It cannot be merged. You are prohibited from placing a tile that connects two Safe chains.</p>
              </section>
              <section>
                <h3 className="text-white font-black text-xs uppercase mb-2">III. Merger Bonuses</h3>
                <p>When a merger occurs, the largest chain survives. The top two stockholders of the defunct chain receive Primary (10x price) and Secondary (5x price) bonuses.</p>
              </section>
              <section>
                <h3 className="text-white font-black text-xs uppercase mb-2">IV. Operation Termination</h3>
                <p>The operation ends if one chain reaches 41+ tiles or if all active chains are Safe. All assets will be liquidated at current value.</p>
              </section>
            </div>
            <button onClick={() => setRulebookOpen(false)} className="w-full mt-8 bg-amber-500 text-black font-black py-4 rounded-2xl shadow-xl shadow-amber-500/20">ACKNOWLEDGED</button>
          </div>
        </div>
      )}
    </main>
  );
}
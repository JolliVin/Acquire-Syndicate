'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// --- CONSTANTS & METADATA ---
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
type Player = { id: string; lobby_id: string; player_name: string; is_host: boolean; is_spectator: boolean; money: number; hand: string[]; play_order: number | null; stocks: Record<string, number>; starting_tile?: string; };
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

  // --- DATA SYNC ---
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
    const holders = [...currentPlayers].filter(pl => !pl.is_spectator).sort((a, b) => (b.stocks[corp] || 0) - (a.stocks[corp] || 0));
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

  // --- CORE GAME ACTIONS ---
  const handleStartGame = async () => {
    const activePlayers = players.filter(p => !p.is_spectator);
    if (!lobbyInfo || activePlayers.length < 3) return;
    setIsStarting(true);
    let validStart = false; let finalUpdates: any[] = []; let pool: string[] = [];
    while (!validStart) {
      pool = []; for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
      pool = pool.sort(() => Math.random() - 0.5);
      const drawResults = activePlayers.map(p => ({ ...p, draw: pool.pop()! }));
      const drawnTiles = drawResults.map(d => d.draw);
      if (!drawnTiles.some(t => getNeighbors(t).some(n => drawnTiles.includes(n)))) {
        drawResults.sort((a, b) => getTileValue(a.draw) - getTileValue(b.draw));
        finalUpdates = drawResults.map((p, index) => ({ id: p.id, lobby_id: lobbyInfo.id, player_name: p.player_name, is_host: p.is_host, is_spectator: false, money: 6000, stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), starting_tile: p.draw, hand: pool.splice(-6), play_order: index }));
        validStart = true;
      }
    }
    await supabase.from('players').upsert(finalUpdates);
    await supabase.from('lobbies').update({ status: 'playing', board_state: finalUpdates.map(u => u.starting_tile), tile_pool: pool, turn_phase: 'place_tile', current_turn_index: 0, active_chains: [], chain_sizes: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), tile_ownership: finalUpdates.reduce((a,u)=>({...a,[u.starting_tile]:null}),{}) }).eq('id', lobbyInfo.id);
    setIsStarting(false);
  };

  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !cur || cur.player_name !== playerName || cur.is_spectator) return;
    const adj = getNeighbors(tile).filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    if (corps.filter(c => lobbyInfo.chain_sizes[c] >= 11).length > 1) return alert("Illegal Move!");

    let next = 'buy_stocks'; let mergerData = lobbyInfo.merger_data || {};
    if (corps.length > 1) {
      next = 'merger_resolution';
      const sorted = [...corps].sort((a,b) => lobbyInfo.chain_sizes[b] - lobbyInfo.chain_sizes[a]);
      const tied = sorted.filter(c => lobbyInfo.chain_sizes[c] === lobbyInfo.chain_sizes[sorted[0]]);
      mergerData = { defunct_corps: corps, potential_survivors: tied, tile_placed: tile, is_tied: tied.length > 1, mergemaker_id: cur.id };
      if (!mergerData.is_tied) {
        const survivor = tied[0]; const defunct = corps.find(c => c !== survivor)!;
        mergerData = { ...mergerData, survivor, current_defunct: defunct };
        const payouts = calculateMergerBonuses(defunct, players);
        for (const p of payouts) await supabase.from('players').update({ money: p.money }).eq('id', p.id);
      }
    } else if (corps.length === 0 && adj.length > 0) next = 'found_chain';
    else if (corps.length === 1) {
       const c = corps[0];
       await supabase.from('lobbies').update({ chain_sizes: { ...lobbyInfo.chain_sizes, [c]: lobbyInfo.chain_sizes[c] + 1 }, tile_ownership: { ...lobbyInfo.tile_ownership, [tile]: c } }).eq('id', lobbyInfo.id);
    }

    await supabase.from('players').update({ hand: cur.hand.filter(t => t !== tile) }).eq('id', cur.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next, merger_data: mergerData, disposition_turn_index: lobbyInfo.current_turn_index }).eq('id', lobbyInfo.id);
  };

  const handleSelectSurvivor = async (survivor: string) => {
    const defunct = lobbyInfo!.merger_data.defunct_corps.find((c:string) => c !== survivor);
    const payouts = calculateMergerBonuses(defunct, players);
    for (const p of payouts) await supabase.from('players').update({ money: p.money }).eq('id', p.id);
    await supabase.from('lobbies').update({ merger_data: { ...lobbyInfo!.merger_data, survivor, current_defunct: defunct, is_tied: false }}).eq('id', lobbyInfo!.id);
  };

  const handleDisposition = async (action: 'sell' | 'trade' | 'keep') => {
    const cur = players.find(p => p.play_order === lobbyInfo!.disposition_turn_index);
    const defunct = lobbyInfo!.merger_data.current_defunct; const survivor = lobbyInfo!.merger_data.survivor;
    const count = cur!.stocks[defunct] || 0; let m = cur!.money; let s = { ...cur!.stocks };
    if (action === 'sell') { m += count * getStockPrice(defunct, lobbyInfo!.chain_sizes[defunct]); s[defunct] = 0; }
    else if (action === 'trade') { const pairs = Math.floor(count/2); s[defunct] -= pairs*2; s[survivor] = (s[survivor] || 0) + pairs; }
    
    const nextIdx = (lobbyInfo!.disposition_turn_index! + 1) % players.filter(p=>!p.is_spectator).length;
    if (nextIdx === lobbyInfo!.current_turn_index) {
      const ownership = { ...lobbyInfo!.tile_ownership };
      Object.keys(ownership).forEach(t => { if (ownership[t] === defunct || t === lobbyInfo!.merger_data.tile_placed) ownership[t] = survivor; });
      await supabase.from('lobbies').update({ tile_ownership: ownership, turn_phase: 'buy_stocks', active_chains: lobbyInfo!.active_chains.filter(c => c !== defunct) }).eq('id', lobbyInfo!.id);
    }
    await supabase.from('players').update({ money: m, stocks: s }).eq('id', cur!.id);
    await supabase.from('lobbies').update({ disposition_turn_index: nextIdx }).eq('id', lobbyInfo!.id);
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

  const handleEndTurn = async () => {
    const cur = players.find(p => p.play_order === lobbyInfo!.current_turn_index);
    const pool = [...lobbyInfo!.tile_pool]; const hand = [...cur!.hand];
    if (pool.length > 0) hand.push(pool.pop()!);
    setStocksBoughtThisTurn(0);
    await supabase.from('players').update({ hand }).eq('id', cur!.id);
    await supabase.from('lobbies').update({ tile_pool: pool, current_turn_index: (lobbyInfo!.current_turn_index + 1) % players.filter(p=>!p.is_spectator).length, turn_phase: 'place_tile' }).eq('id', lobbyInfo!.id);
  };

  const handleEndGame = async () => {
    const active = players.filter(p=>!p.is_spectator);
    let standings = active.map(p => {
      let cash = p.money;
      CORPORATIONS.forEach(c => { if (lobbyInfo!.active_chains.includes(c)) cash += (p.stocks[c] || 0) * getStockPrice(c, lobbyInfo!.chain_sizes[c]); });
      return { ...p, money: cash };
    }).sort((a,b) => b.money - a.money);
    await supabase.from('lobbies').update({ status: 'finished', winner_data: standings }).eq('id', lobbyInfo!.id);
  };

  // --- MESSAGING ---
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !lobbyInfo || !playerName) return;
    await supabase.from('messages').insert([{ lobby_id: lobbyInfo.id, player_name: playerName, content: chatInput }]);
    setChatInput('');
  };

  // --- LOBBY LOGIC ---
  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault(); if (!playerName.trim()) return;
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{ name: `${playerName}'s Game`, join_code: code, status: 'waiting', available_stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:25}),{}) }]).select().single();
    if (l) { await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]); setIsHost(true); setLobbyInfo(l as Lobby); }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault(); if (!joinCodeInput.trim()) return;
    const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) {
      const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', l.id);
      const isSpec = (count || 0) >= 6;
      await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: false, is_spectator: isSpec, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]);
      setLobbyInfo(l as Lobby);
    }
  };

  const me = players.find(p => p.player_name === playerName);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-40 shadow-lg">
        <h1 className="text-xl font-black text-amber-500 italic">ACQUIRE SYNDICATE</h1>
        <div className="flex gap-2 items-center">
          {me?.is_spectator && <span className="text-[10px] bg-slate-800 text-amber-500 px-3 py-1.5 rounded-full font-bold border border-amber-500/20 animate-pulse">Spectating</span>}
          <button onClick={() => setRulebookOpen(true)} className="text-[10px] bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700 font-bold">PROTOCOL</button>
          {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden relative">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
          
          {/* LOBBY SCREENS */}
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
                    <input type="text" maxLength={6} required value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-800 p-4 rounded-xl text-center font-mono tracking-widest" placeholder="XXXXXX"/>
                    <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">JOIN</button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* WAITING ROOM */}
          {lobbyInfo && lobbyInfo.status === 'waiting' && (
            <div className="lg:col-span-12 flex flex-col items-center justify-center h-full p-6 text-center">
               <h2 className="text-5xl font-mono font-black text-amber-400 mb-8 tracking-widest">{lobbyInfo.join_code}</h2>
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl w-full max-w-sm mb-6 shadow-2xl">
                  <div className="text-[10px] uppercase text-slate-500 mb-2 font-bold tracking-widest">Active Agents ({players.filter(p=>!p.is_spectator).length}/6)</div>
                  {players.filter(p=>!p.is_spectator).map(p => <div key={p.id} className="py-2 border-b border-slate-800 last:border-0 flex justify-between"><span>{p.player_name}</span>{p.is_host && <span className="text-amber-500 font-bold">★</span>}</div>)}
                  {players.some(p=>p.is_spectator) && (
                    <div className="mt-4 pt-4 border-t border-slate-700 text-left">
                      <div className="text-[10px] uppercase text-slate-500 mb-2 font-bold tracking-widest">Spectator Lounge</div>
                      {players.filter(p=>p.is_spectator).map(p => <div key={p.id} className="text-xs text-slate-400 py-1 italic">👁 {p.player_name}</div>)}
                    </div>
                  )}
               </div>
               {isHost && (
                 <div className="space-y-4">
                   {players.filter(p=>!p.is_spectator).length < 3 && <p className="text-rose-400 text-[10px] font-bold uppercase">3 Active Agents Required</p>}
                   <button onClick={handleStartGame} disabled={isStarting || players.filter(p=>!p.is_spectator).length < 3} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black shadow-xl shadow-emerald-500/20 disabled:opacity-20">{isStarting ? 'INITIATING...' : 'INITIATE OPERATION'}</button>
                 </div>
               )}
            </div>
          )}

          {/* PLAYING VIEW */}
          {lobbyInfo && lobbyInfo.status === 'playing' && (
            <>
              {/* BOARD */}
              <div className={`lg:col-span-8 flex flex-col p-4 lg:p-6 bg-slate-900 lg:rounded-2xl lg:border border-slate-800 overflow-auto ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="min-w-[580px] lg:min-w-0 relative">
                  {/* MODALS */}
                  {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500 backdrop-blur-md">
                      <div className="text-center">
                        <h2 className="text-2xl font-black text-amber-400 mb-6">FOUND CORPORATION</h2>
                        <div className="grid grid-cols-2 gap-2">
                          {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                            <button key={corp} onClick={() => handleFoundChain(corp)} className="bg-slate-800 border border-slate-700 p-4 rounded-xl font-bold hover:border-amber-500 transition-all">{corp}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {lobbyInfo.turn_phase === 'merger_resolution' && lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500">
                      <div className="text-center">
                        <h2 className="text-2xl font-black text-amber-400 mb-4">MERGER TIE-BREAKER</h2>
                        <div className="grid grid-cols-2 gap-2">
                          {lobbyInfo.merger_data.potential_survivors.map((c:string) => (
                            <button key={c} onClick={() => handleSelectSurvivor(c)} className="bg-slate-800 border-2 border-amber-500 p-4 rounded-xl font-black">{c}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {lobbyInfo.turn_phase === 'merger_resolution' && !lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.disposition_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/95 flex items-center justify-center p-6 rounded-xl border-4 border-emerald-500 backdrop-blur-md">
                      <div className="text-center w-full max-w-sm">
                        <h2 className="text-2xl font-black text-emerald-400 mb-2 uppercase">Disposition</h2>
                        <p className="text-[10px] text-slate-500 mb-6 uppercase tracking-widest">{lobbyInfo.merger_data.current_defunct} → {lobbyInfo.merger_data.survivor}</p>
                        <div className="flex flex-col gap-2">
                           <button onClick={() => handleDisposition('sell')} className="bg-slate-100 text-black font-black py-3 rounded-xl">SELL ALL SHARES</button>
                           <button onClick={() => handleDisposition('trade')} className="bg-amber-600 text-white font-black py-3 rounded-xl">TRADE 2-FOR-1</button>
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
                      return <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-[10px] font-bold border-2 transition-all duration-300 ${isP ? (owner ? `${meta?.bg} ${meta?.text} border-white shadow-lg` : 'bg-amber-500 text-black border-amber-400') : 'bg-slate-800/50 text-slate-700 border-slate-800'}`}>{id}</div>;
                    }))}
                  </div>
                </div>
              </div>

              {/* MARKET & TYCOONS */}
              <div className={`lg:col-span-4 flex flex-col gap-6 p-4 lg:p-0 overflow-y-auto ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 shadow-xl">
                   <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Tycoon Standing</h3>
                   {players.filter(p=>!p.is_spectator).map(p => (
                      <div key={p.id} className={`p-4 rounded-2xl border mb-2 ${lobbyInfo.current_turn_index === p.play_order ? 'border-amber-500 bg-slate-800' : 'border-slate-800 bg-slate-900 opacity-60'}`}>
                         <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-sm">{p.player_name}</span>
                            <span className="text-emerald-400 font-mono text-sm">${p.money.toLocaleString()}</span>
                         </div>
                         <div className="flex flex-wrap gap-1 mb-2">
                            {CORPORATIONS.map(c => p.stocks[c] > 0 ? (
                                <span key={c} className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${CORP_METADATA[c].bg} ${CORP_METADATA[c].text}`}>{c[0]}:{p.stocks[c]}</span>
                            ) : null)}
                         </div>
                         {p.player_name === playerName && !me?.is_spectator && (
                            <div className="flex gap-1 mt-2 overflow-x-auto pb-1 scrollbar-hide">
                              {p.hand.map(t => <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== p.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="bg-amber-500 text-black px-3 py-1.5 rounded-lg font-mono text-[10px] font-black hover:bg-white transition-all disabled:opacity-30">{t}</button>)}
                            </div>
                         )}
                      </div>
                   ))}
                   {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && !me?.is_spectator && (
                     <div className="mt-4 space-y-2">
                        <div className="grid grid-cols-2 gap-1">
                           {CORPORATIONS.filter(c => lobbyInfo.active_chains.includes(c)).map(c => (
                             <button key={c} onClick={() => handleBuyStock(c)} disabled={stocksBoughtThisTurn >= 3 || lobbyInfo.available_stocks[c] <= 0} className="text-[9px] bg-slate-800 p-2 rounded-xl border border-slate-700 font-bold uppercase hover:border-amber-500">Buy {c} (${getStockPrice(c, lobbyInfo.chain_sizes[c])})</button>
                           ))}
                        </div>
                        <button onClick={handleEndTurn} className="w-full bg-emerald-600 py-3 rounded-xl font-black text-sm hover:bg-emerald-500 shadow-lg">CONCLUDE TURN</button>
                     </div>
                   )}
                </div>
              </div>

              {/* CHAT TAB */}
              <div className={`lg:col-span-4 flex flex-col bg-slate-900 lg:rounded-3xl lg:border border-slate-800 h-full shadow-2xl overflow-hidden ${mobileTab !== 'chat' ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-4 bg-slate-800/50 border-b border-slate-800 text-[10px] font-black uppercase tracking-widest flex justify-between"><span>Comms</span><span className="text-emerald-500 animate-pulse">Online</span></div>
                <div className="flex-grow overflow-y-auto p-4 space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex flex-col ${m.player_name === playerName ? 'items-end' : 'items-start'}`}>
                      <span className="text-[8px] text-slate-600 mb-1 font-black uppercase">{m.player_name}</span>
                      <div className={`px-4 py-2 rounded-2xl text-xs ${m.player_name === playerName ? 'bg-amber-500 text-black font-medium' : 'bg-slate-800 text-slate-300'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={sendChat} className="p-4 flex gap-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Send intel..." className="flex-grow bg-slate-800 border border-slate-700 rounded-full px-5 py-2 text-xs outline-none focus:ring-1 focus:ring-amber-500" />
                  <button type="submit" className="bg-amber-500 text-black w-10 h-10 rounded-full font-black">↑</button>
                </form>
              </div>
            </>
          )}

          {/* FINISHED VIEW */}
          {lobbyInfo && lobbyInfo.status === 'finished' && (
            <div className="lg:col-span-12 flex flex-col items-center justify-center h-full p-6 text-center">
               <h2 className="text-6xl font-black italic text-amber-500 mb-10 tracking-tighter uppercase underline decoration-emerald-500">Operation Over</h2>
               <div className="max-w-md w-full space-y-3">
                  {lobbyInfo.winner_data.map((p, i) => (
                    <div key={p.id} className={`flex justify-between items-center p-5 rounded-3xl border-2 ${i === 0 ? 'bg-amber-500/10 border-amber-500 scale-110 shadow-2xl shadow-amber-500/10' : 'bg-slate-900 border-slate-800 opacity-80'}`}>
                       <div className="flex items-center gap-4">
                          <span className="text-3xl font-black italic text-slate-700">#{i+1}</span>
                          <span className="font-black uppercase text-sm">{p.player_name}</span>
                       </div>
                       <span className="text-xl font-mono font-black text-emerald-400">${p.money.toLocaleString()}</span>
                    </div>
                  ))}
               </div>
               <button onClick={() => window.location.reload()} className="mt-12 text-slate-500 text-[10px] font-bold tracking-widest hover:text-white transition-all uppercase">Initialize New Operation</button>
            </div>
          )}
        </div>
      </div>

      {/* MOBILE NAV */}
      {lobbyInfo && lobbyInfo.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-3 items-center z-50">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-lg">◫</span><span className="text-[9px] font-bold uppercase tracking-widest">Board</span></button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-lg">＄</span><span className="text-[9px] font-bold uppercase tracking-widest">Market</span></button>
          <button onClick={() => setMobileTab('chat')} className={`flex flex-col items-center gap-1 ${mobileTab === 'chat' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-lg">💬</span><span className="text-[9px] font-bold uppercase tracking-widest">Comms</span></button>
        </nav>
      )}
    </main>
  );
}
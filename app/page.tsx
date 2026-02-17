'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Peer } from 'peerjs';

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

// --- TYPES ---
type Player = { id: string; lobby_id: string; player_name: string; is_host: boolean; is_spectator: boolean; money: number; hand: string[]; play_order: number | null; stocks: Record<string, number>; starting_tile: string | null; };

type MergerData = {
  is_tied?: boolean;
  potential_survivors?: string[];
  survivor?: string;
  current_defunct?: string;
  defunct_corps?: string[];
  tile_placed?: string;
  mergemaker_id?: string;
};

type Lobby = { 
  id: string; 
  join_code: string; 
  status: string; 
  board_state: string[]; 
  turn_phase: string; 
  current_turn_index: number; 
  chain_sizes: Record<string, number>; 
  active_chains: string[]; 
  tile_ownership: Record<string, string | null>; 
  available_stocks: Record<string, number>; 
  tile_pool: string[]; 
  merger_data: MergerData; 
  disposition_turn_index?: number; 
};

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

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [mobileTab, setMobileTab] = useState<'board' | 'market'>('board');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  const peerInstance = useRef<Peer | null>(null);

  // --- DATA SYNC ---
  useEffect(() => {
    if (!lobbyInfo) return;
    const fetchData = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('play_order', { ascending: true, nullsFirst: false });
      const { data: l } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      if (p) setPlayers(p as Player[]);
      if (l) setLobbyInfo(prev => ({ ...prev!, ...l }));
    };
    fetchData();
    const channel = supabase.channel(`lobby-sync-${lobbyInfo.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, (p) => setLobbyInfo(c => ({ ...c!, ...p.new as Lobby })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lobbyInfo?.id]);

  // --- VOICE ---
  const me = players.find(p => p.player_name === playerName);
  useEffect(() => {
    if (!me?.id || typeof window === 'undefined') return;
    const peer = new Peer(me.id.replace(/-/g, ''));
    peerInstance.current = peer;
    peer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        call.answer(stream);
        call.on('stream', (rms) => { const a = new Audio(); a.srcObject = rms; a.play(); });
      });
    });
    return () => peer.destroy();
  }, [me?.id]);

  const toggleVoice = async () => {
    if (isMicActive) { peerInstance.current?.destroy(); setIsMicActive(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsMicActive(true);
      players.filter(p => p.id !== me?.id && !p.is_spectator).forEach(player => {
        const call = peerInstance.current?.call(player.id.replace(/-/g, ''), stream);
        call?.on('stream', (rms) => { const a = new Audio(); a.srcObject = rms; a.play(); });
      });
    } catch (err) { alert("Mic Access Denied."); }
  };

  // --- LOBBY ACTIONS ---
  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{ 
      name: `${playerName}'s Syndicate`, join_code: code, status: 'waiting', turn_phase: 'place_tile', current_turn_index: 0, board_state: [], active_chains: [], chain_sizes: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}), tile_ownership: {}, available_stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 25 }), {}), merger_data: {}, tile_pool: []
    }]).select().single();
    if (l) {
      await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, is_spectator: false, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}) }]);
      setLobbyInfo(l as Lobby); setIsHost(true);
    }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim() || !joinCodeInput.trim()) return;
    const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) {
      const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', l.id);
      await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: false, is_spectator: (count || 0) >= 6, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}) }]);
      setLobbyInfo(l as Lobby);
    }
  };

  const handleStartGame = async () => {
    const active = players.filter(p => !p.is_spectator);
    if (!lobbyInfo || active.length < 3) return;
    setIsStarting(true);
    let pool: string[] = [];
    for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);
    const drawResults = active.map(p => ({ id: p.id, tile: pool.pop()! }));
    drawResults.sort((a, b) => getTileValue(a.tile) - getTileValue(b.tile));
    for (let i = 0; i < drawResults.length; i++) {
      const res = drawResults[i];
      await supabase.from('players').update({ starting_tile: res.tile, play_order: i, hand: pool.splice(-6) }).eq('id', res.id);
    }
    await supabase.from('lobbies').update({ status: 'playing', board_state: drawResults.map(r => r.tile), tile_pool: pool, turn_phase: 'place_tile', current_turn_index: 0, tile_ownership: drawResults.reduce((acc, r) => ({ ...acc, [r.tile]: null }), {}) }).eq('id', lobbyInfo.id);
    setIsStarting(false);
  };

  // --- MERGER BONUS LOGIC ---
  const distributeMergerBonuses = async (defunct: string, size: number) => {
    if (!lobbyInfo) return;
    const price = getStockPrice(defunct, size);
    const majorityBonus = price * 10;
    const minorityBonus = price * 5;

    const ranked = [...players].filter(p => !p.is_spectator).sort((a, b) => (b.stocks[defunct] || 0) - (a.stocks[defunct] || 0));
    const counts = ranked.map(p => p.stocks[defunct] || 0);
    const max = counts[0];
    if (max === 0) return;

    const firstPlacePlayers = ranked.filter(p => (p.stocks[defunct] || 0) === max);
    let updates = [];

    if (firstPlacePlayers.length > 1) {
      const split = (majorityBonus + minorityBonus) / firstPlacePlayers.length;
      updates = firstPlacePlayers.map(p => ({ id: p.id, money: p.money + split }));
    } else {
      updates.push({ id: firstPlacePlayers[0].id, money: firstPlacePlayers[0].money + majorityBonus });
      const remaining = ranked.filter(p => (p.stocks[defunct] || 0) < max && (p.stocks[defunct] || 0) > 0);
      if (remaining.length > 0) {
        const secondMax = remaining[0].stocks[defunct];
        const secondPlacePlayers = remaining.filter(p => p.stocks[defunct] === secondMax);
        const splitMinority = minorityBonus / secondPlacePlayers.length;
        secondPlacePlayers.forEach(p => updates.push({ id: p.id, money: p.money + splitMinority }));
      } else {
        updates[0].money += minorityBonus;
      }
    }

    for (const up of updates) {
      await supabase.from('players').update({ money: up.money }).eq('id', up.id);
    }
  };

  // --- GAME ACTIONS ---
  const getNeighbors = (t: string) => {
    const c = parseInt(t.match(/\d+/)?.[0] || '0');
    const r = BOARD_ROWS.indexOf(t.match(/[A-I]/)?.[0] || 'A');
    return [`${c-1}${BOARD_ROWS[r]}`, `${c+1}${BOARD_ROWS[r]}`, `${c}${BOARD_ROWS[r-1]}`, `${c}${BOARD_ROWS[r+1]}`];
  };

  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !cur || cur.player_name !== playerName) return;
    const adj = getNeighbors(tile).filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    
    let next = 'buy_stocks'; let mData: MergerData = {};
    if (corps.length > 1) {
      next = 'merger_resolution';
      const sorted = [...corps].sort((a,b) => (lobbyInfo.chain_sizes[b] || 0) - (lobbyInfo.chain_sizes[a] || 0));
      const tied = sorted.filter(c => lobbyInfo.chain_sizes[c] === lobbyInfo.chain_sizes[sorted[0]]);
      
      if (tied.length === 1) {
        const survivor = sorted[0];
        const defuncts = corps.filter(c => c !== survivor);
        for (const d of defuncts) { await distributeMergerBonuses(d, lobbyInfo.chain_sizes[d]); }
        mData = { survivor, current_defunct: defuncts[0], defunct_corps: defuncts, tile_placed: tile };
      } else {
        mData = { is_tied: true, potential_survivors: tied, defunct_corps: corps, tile_placed: tile };
      }
    }
    else if (corps.length === 0 && adj.length > 0) next = 'found_chain';
    else if (corps.length === 1) {
       const c = corps[0];
       await supabase.from('lobbies').update({ chain_sizes: { ...lobbyInfo.chain_sizes, [c]: (lobbyInfo.chain_sizes[c] || 0) + 1 }, tile_ownership: { ...lobbyInfo.tile_ownership, [tile]: c } }).eq('id', lobbyInfo.id);
    }
    await supabase.from('players').update({ hand: cur.hand.filter(t => t !== tile) }).eq('id', cur.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next, merger_data: mData, disposition_turn_index: lobbyInfo.current_turn_index }).eq('id', lobbyInfo.id);
  };

  const handleFoundChain = async (corp: string) => {
    const last = lobbyInfo!.board_state[lobbyInfo!.board_state.length - 1];
    const tiles = [last, ...getNeighbors(last).filter(n => lobbyInfo!.board_state.includes(n) && !lobbyInfo!.tile_ownership[n])];
    const ownership = { ...lobbyInfo!.tile_ownership }; tiles.forEach(t => ownership[t] = corp);
    await supabase.from('lobbies').update({ tile_ownership: ownership, active_chains: [...lobbyInfo!.active_chains, corp], chain_sizes: { ...lobbyInfo!.chain_sizes, [corp]: tiles.length }, turn_phase: 'buy_stocks' }).eq('id', lobbyInfo!.id);
  };

  const handleDisposition = async (action: 'sell' | 'trade' | 'keep') => {
    const cur = players.find(p => p.play_order === lobbyInfo!.disposition_turn_index);
    const defunct = lobbyInfo!.merger_data.current_defunct!;
    const survivor = lobbyInfo!.merger_data.survivor!;
    const count = cur!.stocks[defunct] || 0; let m = cur!.money; let s = { ...cur!.stocks };
    if (action === 'sell') { m += count * getStockPrice(defunct, lobbyInfo!.chain_sizes[defunct]); s[defunct] = 0; }
    else if (action === 'trade') { const pairs = Math.floor(count/2); s[defunct] -= pairs*2; s[survivor] = (s[survivor] || 0) + pairs; }
    const nextIdx = (lobbyInfo!.disposition_turn_index! + 1) % players.filter(p=>!p.is_spectator).length;
    if (nextIdx === lobbyInfo!.current_turn_index) {
      const updatedOwnership = { ...lobbyInfo!.tile_ownership };
      Object.keys(updatedOwnership).forEach(t => { if (updatedOwnership[t] === defunct || t === lobbyInfo!.merger_data.tile_placed) updatedOwnership[t] = survivor; });
      await supabase.from('lobbies').update({ turn_phase: 'buy_stocks', tile_ownership: updatedOwnership, active_chains: lobbyInfo!.active_chains.filter(c => c !== defunct) }).eq('id', lobbyInfo!.id);
    }
    await supabase.from('players').update({ money: m, stocks: s }).eq('id', cur!.id);
    await supabase.from('lobbies').update({ disposition_turn_index: nextIdx }).eq('id', lobbyInfo!.id);
  };

  const handleBuyStock = async (corp: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    const price = getStockPrice(corp, lobbyInfo!.chain_sizes[corp]);
    if (!cur || cur.money < price || stocksBoughtThisTurn >= 3) return;
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

  // --- UI RENDER ---
  const totalStockValue = me ? CORPORATIONS.reduce((acc, c) => acc + ((me.stocks[c] || 0) * getStockPrice(c, lobbyInfo?.chain_sizes[c] || 0)), 0) : 0;
  const netWorth = (me?.money || 0) + totalStockValue;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans uppercase">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-40">
        <h1 className="text-xl font-black text-amber-500 italic tracking-tighter">Acquire Syndicate</h1>
        <div className="flex gap-2">
           <button onClick={toggleVoice} className={`text-[10px] px-3 py-1.5 rounded-full border transition-all ${isMicActive ? 'bg-emerald-500 text-black animate-pulse font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
              {isMicActive ? '🎙 COMMS LIVE' : '🎤 MIC ON'}
           </button>
           {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
          {!lobbyInfo || lobbyInfo.status === 'waiting' ? (
             <div className="lg:col-span-12 flex flex-col items-center justify-center p-6 h-full text-center">
                {!lobbyInfo ? (
                   <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 w-full max-w-md shadow-2xl">
                      <div className="flex flex-col gap-4">
                        <input type="text" maxLength={10} value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl outline-none border border-slate-700 focus:border-amber-500" placeholder="Agent Alias"/>
                        {view === 'home' ? (
                          <>
                            <button onClick={() => setView('create')} className="bg-amber-500 text-black font-black py-4 rounded-xl hover:bg-white transition-all">Establish Syndicate</button>
                            <button onClick={() => setView('join')} className="border-2 border-amber-500 text-amber-500 font-black py-4 rounded-xl hover:bg-amber-500/10">Infiltrate</button>
                          </>
                        ) : (
                          <>
                            {view === 'join' && <input type="text" maxLength={6} value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-800 p-4 rounded-xl text-center font-mono tracking-widest" placeholder="XXXXXX"/>}
                            <button onClick={view === 'create' ? handleCreateLobby : handleJoinLobby} className="bg-amber-500 text-black font-black py-4 rounded-xl">CONFIRM</button>
                            <button onClick={() => setView('home')} className="text-[10px] text-slate-500 font-black mt-2">Back</button>
                          </>
                        )}
                      </div>
                   </div>
                ) : (
                   <div>
                      <h2 className="text-5xl font-mono font-black text-amber-400 mb-8 tracking-tighter">{lobbyInfo.join_code}</h2>
                      <div className="bg-slate-900 p-6 rounded-3xl mb-6 shadow-xl border border-slate-800 w-80 mx-auto">
                         <div className="text-[10px] text-slate-500 mb-4 font-black tracking-widest uppercase">Active Agents ({players.length}/6)</div>
                         <div className="space-y-2">
                           {players.map(p => <div key={p.id} className="py-2 px-4 bg-slate-800/50 rounded-xl flex justify-between items-center text-sm font-bold border border-slate-700/50"><span>{p.player_name}</span>{p.is_host && <span className="text-amber-500 text-xs font-black">HOST</span>}</div>)}
                         </div>
                      </div>
                      {isHost && players.length >= 3 && <button onClick={handleStartGame} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black shadow-lg hover:scale-105 transition-all text-white tracking-widest uppercase">Initiate Operation</button>}
                   </div>
                )}
             </div>
          ) : (
            <>
              {/* BOARD */}
              <div className={`lg:col-span-8 p-4 lg:p-6 bg-slate-900 lg:rounded-3xl border border-slate-800 overflow-auto ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'} flex-col relative`}>
                
                {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6 backdrop-blur-sm">
                        <div className="text-center bg-slate-900 p-8 rounded-3xl border border-amber-500 shadow-2xl">
                            <h2 className="text-xl font-black text-amber-400 mb-6 tracking-widest">Found Corporation</h2>
                            <div className="grid grid-cols-2 gap-2">
                                {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                                    <button key={corp} onClick={() => handleFoundChain(corp)} className={`${CORP_METADATA[corp].bg} ${CORP_METADATA[corp].text} p-4 rounded-xl font-black text-xs`}>{corp}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {lobbyInfo.turn_phase === 'merger_resolution' && players.find(p => p.play_order === lobbyInfo.disposition_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6 backdrop-blur-sm">
                        <div className="bg-slate-900 border-2 border-emerald-500 p-8 rounded-3xl text-center max-w-sm w-full shadow-2xl">
                            <h2 className="text-xl font-black text-emerald-400 mb-2">Merger Disposition</h2>
                            <p className="text-[10px] text-slate-500 mb-6 uppercase tracking-widest">{lobbyInfo.merger_data.current_defunct} → {lobbyInfo.merger_data.survivor}</p>
                            <div className="flex flex-col gap-3">
                                <button onClick={() => handleDisposition('sell')} className="bg-white text-black font-black py-4 rounded-xl">SELL ALL</button>
                                <button onClick={() => handleDisposition('trade')} className="bg-amber-600 text-white font-black py-4 rounded-xl">TRADE 2:1</button>
                                <button onClick={() => handleDisposition('keep')} className="bg-slate-800 text-white font-bold py-3 rounded-xl border border-slate-700">KEEP ALL</button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="min-w-[580px] grid grid-cols-12 gap-1 sm:gap-2">
                  {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                    const id = `${c}${r}`;
                    const isP = lobbyInfo.board_state.includes(id);
                    const owner = lobbyInfo.tile_ownership[id];
                    return <div key={id} className={`aspect-square flex items-center justify-center rounded-lg text-[10px] font-bold border-2 transition-all duration-300 ${isP ? (owner ? `${CORP_METADATA[owner].bg} text-white border-white shadow-lg` : 'bg-amber-500 text-black border-amber-400 shadow-md') : 'bg-slate-800/50 text-slate-700 border-slate-800'}`}>{id}</div>;
                  }))}
                </div>
                <div className="mt-8 flex gap-2 justify-center">
                   {me?.hand.map(t => (
                      <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== me.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="w-12 h-12 bg-amber-500 rounded-xl text-black font-black text-xs hover:scale-110 disabled:opacity-20 transition-all shadow-xl">{t}</button>
                   ))}
                </div>
              </div>

              {/* SIDEBAR */}
              <div className={`lg:col-span-4 flex flex-col gap-4 ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'} overflow-y-auto pb-20 lg:pb-0`}>
                 <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <h3 className="text-[10px] font-black text-slate-500 mb-3 tracking-widest uppercase">Initial Draw Ceremony</h3>
                    <div className="space-y-2">
                       {players.map(p => (
                          <div key={p.id} className={`flex justify-between items-center px-3 py-2 rounded-lg border ${p.play_order === lobbyInfo.current_turn_index ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-900/50'}`}>
                             <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-slate-500">#{p.play_order! + 1}</span>
                                <span className="text-xs font-bold">{p.player_name}</span>
                             </div>
                             <span className="text-[10px] font-black bg-slate-800 px-2 py-1 rounded text-amber-500 font-mono">{p.starting_tile}</span>
                          </div>
                       ))}
                    </div>
                 </div>

                 <div className="bg-slate-900 p-6 rounded-3xl border border-amber-500/30 shadow-2xl relative overflow-hidden group">
                    <h3 className="text-[10px] font-black text-slate-500 mb-4 tracking-widest uppercase">Portfolio</h3>
                    <div className="flex justify-between items-end">
                       <div>
                          <p className="text-[9px] text-slate-500 font-bold tracking-tight uppercase">Net Worth</p>
                          <p className="text-3xl font-black text-emerald-400 font-mono tracking-tighter">${netWorth.toLocaleString()}</p>
                       </div>
                       <div className="text-right">
                          <p className="text-[9px] text-slate-500 font-bold tracking-tight uppercase">Liquid Cash</p>
                          <p className="text-sm font-bold font-mono text-slate-100">${me?.money.toLocaleString()}</p>
                       </div>
                    </div>
                 </div>

                 <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl flex-grow">
                    <h3 className="text-[10px] font-black text-slate-500 mb-4 tracking-widest uppercase">Market Exchange</h3>
                    <table className="w-full text-left">
                       <tbody className="text-xs">
                          {CORPORATIONS.map(corp => {
                             const size = lobbyInfo.chain_sizes[corp] || 0;
                             const price = getStockPrice(corp, size);
                             const isSoldOut = (lobbyInfo.available_stocks[corp] || 0) <= 0;
                             const isTurn = lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks';
                             return (
                                <tr key={corp} className={`border-b border-slate-800/50 last:border-0 ${isSoldOut ? 'opacity-40 grayscale' : ''}`}>
                                   <td className="py-3 flex items-center gap-2 font-bold">
                                      <div className={`w-2 h-2 rounded-full ${CORP_METADATA[corp].bg}`}></div>
                                      <span className={isSoldOut ? 'line-through text-slate-500' : ''}>{corp}</span>
                                   </td>
                                   <td className="py-3 font-mono text-emerald-400 font-bold">${price}</td>
                                   <td className="py-3 text-right">
                                      {!isSoldOut && (
                                         <button onClick={() => handleBuyStock(corp)} disabled={!isTurn || stocksBoughtThisTurn >= 3 || (me?.money || 0) < price} className="bg-amber-500 text-black px-3 py-1 rounded-lg text-[10px] font-black hover:bg-white disabled:opacity-10 shadow-sm uppercase">BUY</button>
                                      )}
                                   </td>
                                </tr>
                             );
                          })}
                       </tbody>
                    </table>
                    {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && (
                       <button onClick={handleEndTurn} className="w-full mt-4 bg-emerald-600 py-3 rounded-xl font-black text-sm tracking-widest shadow-lg uppercase">End Turn</button>
                    )}
                 </div>
              </div>
            </>
          )}
        </div>
      </div>

      {lobbyInfo && lobbyInfo.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-2 items-center z-50 fixed bottom-0 left-0 right-0">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl font-bold">◫</span><span className="text-[9px] font-black uppercase tracking-widest">Grid</span></button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl font-bold">＄</span><span className="text-[9px] font-black uppercase tracking-widest">Market</span></button>
        </nav>
      )}
    </main>
  );
}
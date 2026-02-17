'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Peer } from 'peerjs';

// --- INTERFACES (Eliminates VSC Type Problems) ---
interface Player {
  id: string;
  lobby_id: string;
  player_name: string;
  is_host: boolean;
  is_spectator: boolean;
  money: number;
  hand: string[];
  play_order: number | null;
  stocks: Record<string, number>;
  starting_tile: string | null;
}

interface MergerData {
  survivor?: string;
  current_defunct?: string;
  defunct_corps?: string[];
  tile_placed?: string;
}

interface Lobby {
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
  disposition_turn_index: number;
}

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

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [mobileTab, setMobileTab] = useState<'board' | 'market'>('board');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
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
      if (l) setLobbyInfo(l as Lobby);
    };
    fetchData();
    const channel = supabase.channel(`sync-${lobbyInfo.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lobbyInfo?.id]);

  const me = players.find(p => p.player_name === playerName);

  // --- VOICE COMMS ---
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
      players.filter(p => p.id !== me?.id).forEach(player => {
        const call = peerInstance.current?.call(player.id.replace(/-/g, ''), stream);
        call?.on('stream', (rms) => { const a = new Audio(); a.srcObject = rms; a.play(); });
      });
    } catch (err) { alert("Mic Access Denied."); }
  };

  // --- CORE LOGIC ---
  const handlePlaceTile = async (tile: string) => {
    if (!lobbyInfo || !me) return;
    const col = parseInt(tile.match(/\d+/)?.[0] || '0');
    const row = tile.match(/[A-I]/)?.[0] || 'A';
    const adj = [`${col-1}${row}`, `${col+1}${row}`, `${col}${String.fromCharCode(row.charCodeAt(0)-1)}`, `${col}${String.fromCharCode(row.charCodeAt(0)+1)}`].filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));

    let next = 'buy_stocks';
    let mData: MergerData = {};

    if (corps.length > 1) {
      next = 'merger_resolution';
      const sorted = [...corps].sort((a,b) => lobbyInfo.chain_sizes[b] - lobbyInfo.chain_sizes[a]);
      mData = { survivor: sorted[0], current_defunct: sorted[1], defunct_corps: sorted.slice(1), tile_placed: tile };
    } 
    else if (corps.length === 0 && adj.length > 0 && lobbyInfo.active_chains.length < 7) next = 'found_chain';
    else if (corps.length === 1) {
      const c = corps[0];
      await supabase.from('lobbies').update({ 
        chain_sizes: { ...lobbyInfo.chain_sizes, [c]: lobbyInfo.chain_sizes[c] + 1 },
        tile_ownership: { ...lobbyInfo.tile_ownership, [tile]: c }
      }).eq('id', lobbyInfo.id);
    }

    await supabase.from('players').update({ hand: me.hand.filter(t => t !== tile) }).eq('id', me.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next, merger_data: mData, disposition_turn_index: lobbyInfo.current_turn_index }).eq('id', lobbyInfo.id);
  };

  const handleFoundChain = async (corp: string) => {
    if (!lobbyInfo || !me) return;
    const bonusStocks = { ...me.stocks, [corp]: (me.stocks[corp] || 0) + 1 };
    await supabase.from('players').update({ stocks: bonusStocks }).eq('id', me.id);
    const last = lobbyInfo.board_state[lobbyInfo.board_state.length - 1];
    await supabase.from('lobbies').update({ 
      active_chains: [...lobbyInfo.active_chains, corp],
      chain_sizes: { ...lobbyInfo.chain_sizes, [corp]: 2 },
      tile_ownership: { ...lobbyInfo.tile_ownership, [last]: corp },
      available_stocks: { ...lobbyInfo.available_stocks, [corp]: lobbyInfo.available_stocks[corp] - 1 },
      turn_phase: 'buy_stocks'
    }).eq('id', lobbyInfo.id);
  };

  const handleBuyStock = async (corp: string) => {
    if (!lobbyInfo || !me) return;
    const price = getStockPrice(corp, lobbyInfo.chain_sizes[corp] || 0);
    if (me.money < price || stocksBoughtThisTurn >= 3) return;
    setStocksBoughtThisTurn(prev => prev + 1);
    await supabase.from('players').update({ money: me.money - price, stocks: { ...me.stocks, [corp]: (me.stocks[corp] || 0) + 1 } }).eq('id', me.id);
    await supabase.from('lobbies').update({ available_stocks: { ...lobbyInfo.available_stocks, [corp]: lobbyInfo.available_stocks[corp] - 1 } }).eq('id', lobbyInfo.id);
  };

  const handleDisposition = async (action: 'sell' | 'trade' | 'keep') => {
    if (!lobbyInfo || !me) return;
    const defunct = lobbyInfo.merger_data.current_defunct!;
    const survivor = lobbyInfo.merger_data.survivor!;
    const count = me.stocks[defunct] || 0;
    let m = me.money; let s = { ...me.stocks };

    if (action === 'sell') { m += count * getStockPrice(defunct, lobbyInfo.chain_sizes[defunct]); s[defunct] = 0; }
    else if (action === 'trade') { const pairs = Math.floor(count/2); s[defunct] -= pairs*2; s[survivor] = (s[survivor] || 0) + pairs; }

    const activePlayers = players.filter(p => !p.is_spectator);
    const nextIdx = (lobbyInfo.disposition_turn_index + 1) % activePlayers.length;
    
    if (nextIdx === lobbyInfo.current_turn_index) {
        const updatedOwnership = { ...lobbyInfo.tile_ownership };
        Object.keys(updatedOwnership).forEach(k => { if (updatedOwnership[k] === defunct) updatedOwnership[k] = survivor; });
        updatedOwnership[lobbyInfo.merger_data.tile_placed!] = survivor;
        await supabase.from('lobbies').update({ 
            turn_phase: 'buy_stocks', 
            tile_ownership: updatedOwnership,
            active_chains: lobbyInfo.active_chains.filter(c => c !== defunct),
            chain_sizes: { ...lobbyInfo.chain_sizes, [survivor]: lobbyInfo.chain_sizes[survivor] + lobbyInfo.chain_sizes[defunct] + 1 }
        }).eq('id', lobbyInfo.id);
    }
    await supabase.from('players').update({ money: m, stocks: s }).eq('id', me.id);
    await supabase.from('lobbies').update({ disposition_turn_index: nextIdx }).eq('id', lobbyInfo.id);
  };

  const handleEndTurn = async () => {
    if (!lobbyInfo || !me) return;
    const pool = [...lobbyInfo.tile_pool];
    const hand = [...me.hand];
    if (pool.length > 0) hand.push(pool.pop()!);
    setStocksBoughtThisTurn(0);
    const activePlayers = players.filter(p => !p.is_spectator);
    await supabase.from('players').update({ hand }).eq('id', me.id);
    await supabase.from('lobbies').update({ 
      tile_pool: pool, 
      current_turn_index: (lobbyInfo.current_turn_index + 1) % activePlayers.length, 
      turn_phase: 'place_tile' 
    }).eq('id', lobbyInfo.id);
  };

  const handleCreateLobby = async (e: any) => {
    e.preventDefault(); if (!playerName) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{ 
      join_code: code, status: 'waiting', turn_phase: 'place_tile', current_turn_index: 0, 
      board_state: [], active_chains: [], chain_sizes: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), 
      tile_ownership: {}, available_stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:25}),{}), tile_pool: [] 
    }]).select().single();
    if (l) {
      await supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, money: 6000, stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), hand: [] }]);
      setLobbyInfo(l as Lobby); setIsHost(true);
    }
  };

  const handleJoinLobby = async (e: any) => {
    e.preventDefault(); if (!playerName || !joinCodeInput) return;
    const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) {
      const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', l.id);
      await supabase.from('players').insert([{ 
        lobby_id: l.id, player_name: playerName, is_host: false, 
        is_spectator: (count || 0) >= 6, money: 6000, 
        stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}), hand: [] 
      }]);
      setLobbyInfo(l as Lobby);
    }
  };

  const handleStartGame = async () => {
    if (!lobbyInfo) return;
    const active = players.filter(p => !p.is_spectator);
    let pool: string[] = [];
    for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);
    const drawResults = active.map(p => ({ id: p.id, tile: pool.pop()! }));
    drawResults.sort((a, b) => getTileValue(a.tile) - getTileValue(b.tile));
    for (let i = 0; i < drawResults.length; i++) {
      await supabase.from('players').update({ play_order: i, starting_tile: drawResults[i].tile, hand: pool.splice(-6) }).eq('id', drawResults[i].id);
    }
    await supabase.from('lobbies').update({ status: 'playing', board_state: drawResults.map(r => r.tile), tile_pool: pool }).eq('id', lobbyInfo.id);
  };

  const netWorth = me ? (me.money + CORPORATIONS.reduce((acc, c) => acc + ((me.stocks[c] || 0) * getStockPrice(c, lobbyInfo?.chain_sizes[c] || 0)), 0)) : 0;
  const canEndGame = (lobbyInfo?.active_chains?.length === 7) && (Object.values(lobbyInfo?.chain_sizes || {}).some((s:any) => s >= 41) || lobbyInfo.active_chains.every((c:any) => lobbyInfo.chain_sizes[c] >= 11));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans uppercase">
      {/* HEADER */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-50 sticky top-0">
        <h1 className="text-xl font-black text-amber-500 italic">Acquire Syndicate</h1>
        <div className="flex gap-2">
            <button onClick={toggleVoice} className={`text-[9px] px-3 py-1 rounded-full border ${isMicActive ? 'bg-emerald-500 text-black animate-pulse' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
              {isMicActive ? '🎙 COMMS LIVE' : '🎤 MIC OFF'}
            </button>
            {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden">
        {!lobbyInfo ? (
           <div className="max-w-md mx-auto pt-20 px-6 space-y-4">
              <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 outline-none focus:border-amber-500" placeholder="Agent Alias"/>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setView('create')} className="bg-amber-500 text-black font-black p-4 rounded-xl uppercase">Create</button>
                <button onClick={() => setView('join')} className="border-2 border-amber-500 text-amber-500 font-black p-4 rounded-xl uppercase">Join</button>
              </div>
              {view === 'join' && <input type="text" value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 text-center font-mono uppercase" placeholder="XXXXXX"/>}
              {(view === 'join' || view === 'create') && playerName && (
                <button onClick={view === 'create' ? handleCreateLobby : handleJoinLobby} className="w-full bg-emerald-500 text-white font-black p-4 rounded-xl uppercase">Confirm Operation</button>
              )}
           </div>
        ) : lobbyInfo.status === 'waiting' ? (
           <div className="text-center pt-20">
              <h2 className="text-6xl font-mono text-amber-400 mb-10 tracking-tighter">{lobbyInfo.join_code}</h2>
              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 w-80 mx-auto space-y-2 mb-10">
                {players.map(p => <div key={p.id} className="text-sm font-bold flex justify-between uppercase"><span>{p.player_name}</span> {p.is_host && <span className="text-amber-500 text-[10px]">HOST</span>}</div>)}
              </div>
              {isHost && players.length >= 3 && <button onClick={handleStartGame} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black text-white shadow-xl uppercase">Initiate Syndicate</button>}
           </div>
        ) : (
           <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
              {/* BOARD */}
              <div className={`lg:col-span-8 p-4 lg:p-6 bg-slate-900 lg:rounded-3xl border border-slate-800 overflow-auto flex flex-col relative ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'}`}>
                {/* MODALS */}
                {lobbyInfo.turn_phase === 'found_chain' && me?.play_order === lobbyInfo.current_turn_index && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex items-center justify-center p-4">
                    <div className="bg-slate-900 p-8 rounded-3xl border border-amber-500 shadow-2xl text-center">
                      <h3 className="font-black text-amber-500 mb-6 uppercase tracking-widest">Found Building</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(c => (
                          <button key={c} onClick={() => handleFoundChain(c)} className={`${CORP_METADATA[c].bg} p-4 rounded-xl font-black text-xs`}>{c}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {lobbyInfo.turn_phase === 'merger_resolution' && players[lobbyInfo.disposition_turn_index]?.player_name === playerName && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex items-center justify-center p-4">
                    <div className="bg-slate-900 p-8 rounded-3xl border border-emerald-500 shadow-2xl text-center max-w-sm w-full">
                      <h3 className="font-black text-emerald-400 mb-2 uppercase">Merger Disposition</h3>
                      <p className="text-[10px] text-slate-500 mb-6 uppercase tracking-widest">{lobbyInfo.merger_data.current_defunct} is Defunct</p>
                      <div className="flex flex-col gap-3">
                        <button onClick={() => handleDisposition('sell')} className="bg-white text-black font-black py-4 rounded-xl">SELL ALL</button>
                        <button onClick={() => handleDisposition('trade')} className="bg-amber-600 text-white font-black py-4 rounded-xl">TRADE 2:1</button>
                        <button onClick={() => handleDisposition('keep')} className="bg-slate-800 text-white font-bold py-3 rounded-xl border border-slate-700">KEEP ALL</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-12 gap-1 mb-8">
                  {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                    const id = `${c}${r}`;
                    const owner = lobbyInfo.tile_ownership[id];
                    const isPlaced = lobbyInfo.board_state.includes(id);
                    const isSafe = owner && lobbyInfo.chain_sizes[owner] >= 11;
                    return (
                      <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-md text-[8px] lg:text-[10px] font-bold border transition-all ${isPlaced ? (owner ? `${CORP_METADATA[owner].bg} border-white` : 'bg-amber-500 text-black border-amber-400') : 'bg-slate-800/30 text-slate-700 border-slate-800/50'}`}>
                        {id} {isSafe && <span className="text-[8px] mt-0.5">🛡️</span>}
                      </div>
                    );
                  }))}
                </div>
                <div className="flex justify-center gap-2 mt-auto">
                   {me?.hand?.map((t: string) => (
                      <button key={t} onClick={() => handlePlaceTile(t)} disabled={lobbyInfo.current_turn_index !== me.play_order || lobbyInfo.turn_phase !== 'place_tile'} className="w-12 h-12 lg:w-16 lg:h-16 bg-amber-500 text-black font-black rounded-xl shadow-xl hover:scale-110 disabled:opacity-20 transition-all uppercase">{t}</button>
                   ))}
                </div>
              </div>

              {/* SIDEBAR */}
              <div className={`lg:col-span-4 flex flex-col gap-4 overflow-y-auto pb-24 lg:pb-0 ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
                 <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                    <h3 className="text-[9px] font-black text-slate-500 mb-3 uppercase tracking-widest">Draw Ceremony</h3>
                    <div className="space-y-1">
                       {players.map(p => (
                          <div key={p.id} className={`flex justify-between items-center px-3 py-2 rounded-lg border ${p.play_order === lobbyInfo.current_turn_index ? 'border-amber-500 bg-amber-500/5' : 'border-transparent bg-slate-800/50'}`}>
                             <span className="text-xs font-bold uppercase">{p.player_name}</span>
                             <span className="text-[9px] font-black bg-slate-900 px-2 py-1 rounded text-amber-500 font-mono">{p.starting_tile}</span>
                          </div>
                       ))}
                    </div>
                 </div>
                 <div className="bg-slate-900 p-6 rounded-3xl border border-amber-500/20 shadow-xl">
                    <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase border-b border-slate-800 pb-2 tracking-widest">Portfolio</h3>
                    <div className="flex justify-between items-end mb-6">
                       <div><p className="text-[8px] text-slate-500 font-bold uppercase">Cash</p><p className="text-3xl font-black text-emerald-400 font-mono">${me?.money.toLocaleString()}</p></div>
                       <div className="text-right"><p className="text-[8px] text-slate-500 font-bold uppercase">Net Worth</p><p className="text-sm font-bold font-mono text-slate-100">${netWorth.toLocaleString()}</p></div>
                    </div>
                    <div className="space-y-1">
                       {CORPORATIONS.map(c => (
                          <div key={c} className={`flex justify-between text-[10px] font-bold p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30 ${me?.stocks[c] ? 'opacity-100' : 'opacity-10 grayscale'}`}>
                             <span className="uppercase tracking-tighter">{c}</span><span className="font-mono text-amber-500">{me?.stocks[c] || 0}</span>
                          </div>
                       ))}
                    </div>
                 </div>
                 <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl flex-grow">
                    <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase tracking-widest">Exchange</h3>
                    <div className="space-y-2">
                       {CORPORATIONS.map(c => {
                          const size = lobbyInfo.chain_sizes[c] || 0;
                          const active = lobbyInfo.active_chains.includes(c);
                          const price = getStockPrice(c, size);
                          return (
                            <div key={c} className={`w-full flex justify-between items-center p-3 rounded-xl font-black text-[10px] border ${active ? 'bg-slate-800 border-slate-700' : 'opacity-10 border-transparent'}`}>
                              <span>{c} ({size})</span>
                              <div className="flex items-center gap-3">
                                <span className="text-emerald-400 font-mono">${price}</span>
                                <button onClick={() => handleBuyStock(c)} disabled={!active || lobbyInfo.current_turn_index !== me?.play_order || stocksBoughtThisTurn >= 3 || (me?.money || 0) < price} className="bg-amber-500 text-black px-2 py-1 rounded text-[9px] disabled:opacity-0 uppercase">Buy</button>
                              </div>
                            </div>
                          );
                       })}
                       {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && (
                          <button onClick={handleEndTurn} className="w-full bg-emerald-600 py-4 rounded-2xl font-black text-[10px] mt-4 uppercase tracking-widest">Commit & End Turn</button>
                       )}
                    </div>
                 </div>
              </div>
           </div>
        )}
      </div>

      {/* MOBILE NAV */}
      {lobbyInfo?.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-2 items-center z-50 fixed bottom-0 left-0 right-0">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl font-bold">◫</span><span className="text-[8px] font-black tracking-widest">Board</span></button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl font-bold">＄</span><span className="text-[8px] font-black tracking-widest">Market</span></button>
        </nav>
      )}
    </main>
  );
}
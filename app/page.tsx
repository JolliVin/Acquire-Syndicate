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
type Player = { id: string; lobby_id: string; player_name: string; is_host: boolean; is_spectator: boolean; money: number; hand: string[]; play_order: number | null; stocks: Record<string, number>; starting_tile?: string; };

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
  winner_data: any[]; 
};

type Message = { player_name: string; content: string; created_at: string; };

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
  const [mobileTab, setMobileTab] = useState<'board' | 'market' | 'chat'>('board');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  const peerInstance = useRef<Peer | null>(null);
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, (p) => setLobbyInfo(c => ({ ...c!, ...p.new as Lobby })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `lobby_id=eq.${lobbyInfo.id}` }, 
        (payload) => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [lobbyInfo?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // --- VOICE (PeerJS) ---
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

  // --- GAME FUNCTIONS ---
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

  const handleStartGame = async () => {
    const active = players.filter(p => !p.is_spectator);
    if (!lobbyInfo || active.length < 3) return;
    setIsStarting(true);
    let valid = false; let updates: any[] = []; let pool: string[] = [];
    while (!valid) {
      pool = []; for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
      pool = pool.sort(() => Math.random() - 0.5);
      const draws = active.map(p => ({ ...p, d: pool.pop()! }));
      const tiles = draws.map(d => d.d);
      if (!tiles.some(t => getNeighbors(t).some(n => tiles.includes(n)))) {
        draws.sort((a,b) => getTileValue(a.d) - getTileValue(b.d));
        updates = draws.map((p, i) => ({ id: p.id, lobby_id: lobbyInfo.id, player_name: p.player_name, money: 6000, stocks: CORPORATIONS.reduce((acc,c)=>({...acc,[c]:0}),{}), starting_tile: p.d, hand: pool.splice(-6), play_order: i }));
        valid = true;
      }
    }
    await supabase.from('players').upsert(updates);
    await supabase.from('lobbies').update({ status: 'playing', board_state: updates.map(u => u.starting_tile), tile_pool: pool, turn_phase: 'place_tile', current_turn_index: 0, chain_sizes: CORPORATIONS.reduce((acc,c)=>({...acc,[c]:0}),{}), tile_ownership: updates.reduce((acc,u)=>({...acc,[u.starting_tile]:null}),{}) }).eq('id', lobbyInfo.id);
    setIsStarting(false);
  };

  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !cur || cur.player_name !== playerName || cur.is_spectator) return;
    const adj = getNeighbors(tile).filter(n => lobbyInfo.board_state.includes(n));
    const corps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    if (corps.filter(c => lobbyInfo.chain_sizes[c] >= 11).length > 1) return alert("Illegal Merger!");
    let next = 'buy_stocks'; let mergerData: MergerData = {};
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
    const defunct = lobbyInfo!.merger_data.defunct_corps?.find((c:string) => c !== survivor);
    if (!defunct) return;
    const payouts = calculateMergerBonuses(defunct, players);
    for (const p of payouts) await supabase.from('players').update({ money: p.money }).eq('id', p.id);
    await supabase.from('lobbies').update({ merger_data: { ...lobbyInfo!.merger_data, survivor, current_defunct: defunct, is_tied: false }}).eq('id', lobbyInfo!.id);
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

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault(); if (!chatInput.trim() || !lobbyInfo) return;
    await supabase.from('messages').insert([{ lobby_id: lobbyInfo.id, player_name: playerName, content: chatInput }]);
    setChatInput('');
  };

  // --- RENDERING ---
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center sticky top-0 z-40">
        <h1 className="text-xl font-black text-amber-500 italic">ACQUIRE SYNDICATE</h1>
        <div className="flex gap-2">
           <button onClick={toggleVoice} className={`text-[10px] px-3 py-1.5 rounded-full border ${isMicActive ? 'bg-emerald-500 text-black animate-pulse' : 'bg-slate-800 text-slate-400'}`}>
              {isMicActive ? '🎙 COMMS LIVE' : '🎤 MIC ON'}
           </button>
           {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden relative">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6">
          {!lobbyInfo || lobbyInfo.status === 'waiting' ? (
             <div className="lg:col-span-12 flex flex-col items-center justify-center p-6 h-full">
                {!lobbyInfo ? (
                   <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 w-full max-w-md shadow-2xl">
                      {view === 'home' && (
                        <div className="flex flex-col gap-4">
                          <button onClick={() => setView('create')} className="bg-amber-500 text-black font-black py-4 rounded-xl">CREATE SYNDICATE</button>
                          <button onClick={() => setView('join')} className="border-2 border-amber-500 text-amber-500 font-black py-4 rounded-xl">INFILTRATE</button>
                        </div>
                      )}
                      {view === 'create' && (
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          const code = Math.random().toString(36).substring(2,8).toUpperCase();
                          supabase.from('lobbies').insert([{ join_code: code, status: 'waiting', merger_data: {}, available_stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:25}),{}) }]).select().single()
                            .then(({data: l}) => { if(l) { supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: true, money: 6000, stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }]).then(() => { setLobbyInfo(l as Lobby); setIsHost(true); }) } });
                        }} className="flex flex-col gap-4">
                          <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl outline-none" placeholder="Agent Alias"/>
                          <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">CREATE</button>
                        </form>
                      )}
                      {view === 'join' && (
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single()
                            .then(({data: l}) => { if(l) { 
                              supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', l.id)
                                .then(({count}) => {
                                  const isSpec = (count || 0) >= 6;
                                  supabase.from('players').insert([{ lobby_id: l.id, player_name: playerName, is_host: false, is_spectator: isSpec, money: 6000, hand: [], stocks: CORPORATIONS.reduce((a,c)=>({...a,[c]:0}),{}) }])
                                    .then(() => setLobbyInfo(l as Lobby));
                                });
                            }});
                        }} className="flex flex-col gap-4">
                          <input type="text" maxLength={10} required value={playerName} onChange={e => setPlayerName(e.target.value)} className="bg-slate-800 p-4 rounded-xl mb-2" placeholder="Agent Alias"/>
                          <input type="text" maxLength={6} required value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-800 p-4 rounded-xl text-center font-mono tracking-widest" placeholder="XXXXXX"/>
                          <button type="submit" className="bg-amber-500 text-black font-black py-4 rounded-xl">JOIN</button>
                        </form>
                      )}
                   </div>
                ) : (
                   <div className="text-center">
                      <h2 className="text-5xl font-mono font-black text-amber-400 mb-8">{lobbyInfo.join_code}</h2>
                      <div className="bg-slate-900 p-6 rounded-3xl mb-6 shadow-xl border border-slate-800">
                         <div className="text-[10px] uppercase text-slate-500 mb-2 font-bold tracking-widest">Active Agents ({players.filter(p=>!p.is_spectator).length}/6)</div>
                         {players.map(p => <div key={p.id} className="py-2 flex justify-between border-b border-slate-800/50 last:border-0"><span>{p.player_name}</span>{p.is_spectator ? '👁' : (p.is_host && '★')}</div>)}
                      </div>
                      {isHost && players.length >= 3 && <button onClick={handleStartGame} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black shadow-lg hover:scale-105 transition-all">START OPERATION</button>}
                   </div>
                )}
             </div>
          ) : (
            <>
              {/* BOARD */}
              <div className={`lg:col-span-8 p-4 lg:p-6 bg-slate-900 lg:rounded-2xl border border-slate-800 overflow-auto ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'} flex-col relative`}>
                {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/90 flex items-center justify-center p-6 backdrop-blur-sm">
                        <div className="text-center bg-slate-900 p-8 rounded-3xl border border-amber-500 shadow-2xl">
                            <h2 className="text-xl font-black text-amber-400 mb-6 uppercase tracking-widest">Found Corporation</h2>
                            <div className="grid grid-cols-2 gap-2">
                                {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                                    <button key={corp} onClick={() => handleFoundChain(corp)} className={`${CORP_METADATA[corp].bg} text-white p-4 rounded-xl font-black text-xs`}>{corp}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                {lobbyInfo.turn_phase === 'merger_resolution' && !lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.disposition_turn_index)?.player_name === playerName && (
                    <div className="absolute inset-0 z-30 bg-slate-950/90 flex items-center justify-center p-6 backdrop-blur-sm">
                        <div className="bg-slate-900 border-2 border-emerald-500 p-8 rounded-3xl text-center max-w-sm w-full">
                            <h2 className="text-xl font-black text-emerald-400 mb-2 uppercase">Stock Disposition</h2>
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
              </div>

              {/* MARKET & CHAT */}
              <div className={`lg:col-span-4 flex flex-col gap-4 ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
                 {/* SHADOW MARKET */}
                 <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 shadow-xl overflow-y-auto">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase mb-4 tracking-widest">Syndicate Market</h3>
                    <table className="w-full text-left">
                       <thead className="text-[8px] text-slate-600 uppercase border-b border-slate-800">
                          <tr><th className="pb-2">Corporation</th><th className="pb-2">Price</th><th className="pb-2 text-right">Action</th></tr>
                       </thead>
                       <tbody className="text-xs">
                          {CORPORATIONS.map(corp => {
                             const size = lobbyInfo.chain_sizes[corp] || 0;
                             const price = getStockPrice(corp, size);
                             const isSoldOut = (lobbyInfo.available_stocks[corp] || 0) <= 0;
                             const isTurn = lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks';
                             return (
                                <tr key={corp} className={`border-b border-slate-800/50 last:border-0 ${isSoldOut ? 'opacity-40 grayscale' : ''}`}>
                                   <td className="py-3 flex items-center gap-2">
                                      <div className={`w-2 h-2 rounded-full ${CORP_METADATA[corp].bg}`}></div>
                                      <span className={`font-bold ${isSoldOut ? 'line-through' : ''}`}>{corp}</span>
                                   </td>
                                   <td className="py-3 font-mono text-emerald-400 font-black">${price}</td>
                                   <td className="py-3 text-right">
                                      {isSoldOut ? (
                                         <span className="text-[8px] font-black text-rose-500 border border-rose-500/30 px-2 py-1 rounded uppercase">Depleted</span>
                                      ) : (
                                         <button 
                                            onClick={() => handleBuyStock(corp)}
                                            disabled={!isTurn || stocksBoughtThisTurn >= 3 || (me?.money || 0) < price}
                                            className="bg-amber-500 text-black px-3 py-1 rounded-lg text-[10px] font-black hover:bg-white disabled:opacity-10 transition-all shadow-sm"
                                         >BUY</button>
                                      )}
                                   </td>
                                </tr>
                             );
                          })}
                       </tbody>
                    </table>
                    {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && (
                       <div className="mt-4 pt-4 border-t border-slate-800">
                          <p className="text-[9px] text-slate-500 uppercase mb-2">Capacity: {3 - stocksBoughtThisTurn} Remaining</p>
                          <button onClick={handleEndTurn} className="w-full bg-emerald-600 py-3 rounded-xl font-black text-sm hover:bg-emerald-500 transition-all">CONCLUDE TURN</button>
                       </div>
                    )}
                 </div>

                 {/* COMMS */}
                 <div className="bg-slate-900 rounded-3xl border border-slate-800 flex flex-col h-[200px] shadow-xl">
                    <div className="flex-grow overflow-y-auto p-4 space-y-3">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex flex-col ${m.player_name === playerName ? 'items-end' : 'items-start'}`}>
                                <span className="text-[7px] text-slate-600 mb-1 font-black uppercase tracking-tighter">{m.player_name}</span>
                                <div className={`px-3 py-1.5 rounded-2xl text-[11px] ${m.player_name === playerName ? 'bg-amber-500 text-black font-medium' : 'bg-slate-800 text-slate-300'}`}>{m.content}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                    <form onSubmit={sendChat} className="p-3 border-t border-slate-800 flex gap-2">
                        <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Send Intel..." className="flex-grow bg-slate-800 border border-slate-700 rounded-full px-4 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500" />
                        <button type="submit" className="bg-amber-500 text-black w-8 h-8 rounded-full font-black text-sm transition-transform active:scale-90">↑</button>
                    </form>
                 </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MOBILE NAV */}
      {lobbyInfo && lobbyInfo.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-3 items-center z-50">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl">◫</span><span className="text-[9px] font-black uppercase tracking-widest">Grid</span></button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl">＄</span><span className="text-[9px] font-black uppercase tracking-widest">Market</span></button>
          <button onClick={() => setMobileTab('chat')} className={`flex flex-col items-center gap-1 ${mobileTab === 'chat' ? 'text-amber-500' : 'text-slate-600'}`}><span className="text-xl">💬</span><span className="text-[9px] font-black uppercase tracking-widest">Comms</span></button>
        </nav>
      )}
    </main>
  );
}
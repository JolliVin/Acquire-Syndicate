'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Peer } from 'peerjs';

// --- INTERFACES ---
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

  const [sellCount, setSellCount] = useState(0);
  const [tradePairs, setTradePairs] = useState(0);
  const autoSkipRef = useRef<string | null>(null);

  const peerInstance = useRef<Peer | null>(null);

  // --- REALTIME ENGINE ---
  useEffect(() => {
    if (!lobbyInfo) return;

    const fetchData = async () => {
      const { data: p } = await supabase
        .from('players')
        .select('*')
        .eq('lobby_id', lobbyInfo.id)
        .order('play_order', { ascending: true, nullsFirst: false });
      
      const { data: l } = await supabase
        .from('lobbies')
        .select('*')
        .eq('id', lobbyInfo.id)
        .single();
        
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

  // --- COMMS SYSTEM ---
  useEffect(() => {
    if (!me?.id || typeof window === 'undefined') return;
    const peer = new Peer(me.id.replace(/-/g, ''));
    peerInstance.current = peer;
    peer.on('call', (call) => {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        call.answer(stream);
        call.on('stream', (rms) => { 
          const a = new Audio(); 
          a.srcObject = rms; 
          a.play(); 
        });
      });
    });
    return () => peer.destroy();
  }, [me?.id]);

  const toggleVoice = async () => {
    if (isMicActive) { 
      peerInstance.current?.destroy(); 
      setIsMicActive(false); 
      return; 
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsMicActive(true);
      players.filter(p => p.id !== me?.id).forEach(player => {
        const call = peerInstance.current?.call(player.id.replace(/-/g, ''), stream);
        call?.on('stream', (rms) => { 
          const a = new Audio(); 
          a.srcObject = rms; 
          a.play(); 
        });
      });
    } catch (err) { 
      alert("Comms Access Denied."); 
    }
  };

  // --- AUTO-SKIP EMPTY DISPOSITIONS ---
  useEffect(() => {
    if (!lobbyInfo || !me) return;
    if (lobbyInfo.turn_phase === 'merger_resolution' && players[lobbyInfo.disposition_turn_index]?.id === me.id) {
      const defunct = lobbyInfo.merger_data.current_defunct;
      if (defunct && (me.stocks[defunct] || 0) === 0) {
        const turnKey = `${lobbyInfo.id}-${defunct}-${lobbyInfo.disposition_turn_index}`;
        if (autoSkipRef.current !== turnKey) {
          autoSkipRef.current = turnKey;
          handleDisposition(0, 0); // Execute transparent skip
        }
      }
    }
  }, [lobbyInfo?.turn_phase, lobbyInfo?.disposition_turn_index, lobbyInfo?.merger_data.current_defunct]);

  // --- MERGER ENGINE ---
  const distributeBonuses = async (corp: string, size: number) => {
    const price = getStockPrice(corp, size);
    const primaryBonus = price * 10;
    const secondaryBonus = price * 5;
    
    const ranked = [...players]
      .filter(p => !p.is_spectator)
      .sort((a, b) => (b.stocks[corp] || 0) - (a.stocks[corp] || 0));
    
    const counts = ranked.map(p => p.stocks[corp] || 0);
    if (counts[0] === 0) return;

    const primaryHolders = ranked.filter(p => (p.stocks[corp] || 0) === counts[0]);
    
    // Primary Tie: Split Combined Bonuses & Round UP to nearest $100
    if (primaryHolders.length > 1) {
      let split = (primaryBonus + secondaryBonus) / primaryHolders.length;
      split = Math.ceil(split / 100) * 100; // Renegade Rule: No $50s
      
      for (const p of primaryHolders) {
        await supabase.from('players').update({ money: p.money + split }).eq('id', p.id);
      }
    } else {
      // One Primary Holder gets the full Primary Bonus
      await supabase.from('players').update({ money: primaryHolders[0].money + primaryBonus }).eq('id', primaryHolders[0].id);
      
      const secondMax = counts.find(c => c < counts[0] && c > 0);
      const secondaryHolders = ranked.filter(p => (p.stocks[corp] || 0) === secondMax);
      
      if (secondaryHolders.length > 0) {
        // Secondary Tie: Split Secondary Bonus & Round UP to nearest $100
        let splitSecondary = secondaryBonus / secondaryHolders.length;
        splitSecondary = Math.ceil(splitSecondary / 100) * 100; // Renegade Rule: No $50s
        
        for (const p of secondaryHolders) {
          await supabase.from('players').update({ money: p.money + splitSecondary }).eq('id', p.id);
        }
      } else { 
        // Standard rule: If no one else owns stock, the Primary Holder also absorbs the Secondary Bonus
        await supabase.from('players').update({ money: primaryHolders[0].money + secondaryBonus }).eq('id', primaryHolders[0].id); 
      }
    }
  };

  // --- CORE GAME ACTIONS ---
  const handlePlaceTile = async (tile: string) => {
    if (!lobbyInfo || !me) return;
    const col = parseInt(tile.match(/\d+/)?.[0] || '0');
    const row = tile.match(/[A-I]/)?.[0] || 'A';
    
    const adj = [
      `${col-1}${row}`, `${col+1}${row}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)-1)}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)+1)}`
    ].filter(n => lobbyInfo.board_state.includes(n));

    const neighboringCorps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    
    let nextPhase = 'buy_stocks';
    let mData: MergerData = {};

    if (neighboringCorps.length > 1) {
      nextPhase = 'merger_resolution';
      const sorted = [...neighboringCorps].sort((a,b) => (lobbyInfo.chain_sizes[b] || 0) - (lobbyInfo.chain_sizes[a] || 0));
      const survivor = sorted[0];
      const defuncts = sorted.slice(1);
      
      await distributeBonuses(defuncts[0], lobbyInfo.chain_sizes[defuncts[0]]);
      mData = { survivor, current_defunct: defuncts[0], defunct_corps: defuncts, tile_placed: tile };
    } 
    else if (neighboringCorps.length === 1) {
      const survivor = neighboringCorps[0];
      const unincorporatedAdj = adj.filter(n => !lobbyInfo.tile_ownership[n]);
      const newOwnership = { ...lobbyInfo.tile_ownership, [tile]: survivor };
      unincorporatedAdj.forEach(t => { newOwnership[t] = survivor; });
      
      await supabase.from('lobbies').update({ 
        chain_sizes: { ...lobbyInfo.chain_sizes, [survivor]: (lobbyInfo.chain_sizes[survivor] || 0) + 1 + unincorporatedAdj.length },
        tile_ownership: newOwnership 
      }).eq('id', lobbyInfo.id);
    }
    else if (neighboringCorps.length === 0 && adj.length > 0 && lobbyInfo.active_chains.length < 7) {
      nextPhase = 'found_chain';
    }

    await supabase.from('players').update({ hand: me.hand.filter(t => t !== tile) }).eq('id', me.id);
    await supabase.from('lobbies').update({ 
      board_state: [...lobbyInfo.board_state, tile], 
      turn_phase: nextPhase, 
      merger_data: mData, 
      disposition_turn_index: lobbyInfo.current_turn_index 
    }).eq('id', lobbyInfo.id);
  };

  const handleFoundChain = async (corp: string) => {
    if (!lobbyInfo || !me) return;
    const updatedStocks = { ...(me.stocks || {}), [corp]: ((me.stocks || {})[corp] || 0) + 1 };
    const lastTile = lobbyInfo.board_state[lobbyInfo.board_state.length - 1];
    const col = parseInt(lastTile.match(/\d+/)?.[0] || '0');
    const row = lastTile.match(/[A-I]/)?.[0] || 'A';
    
    const cluster = [
      `${col-1}${row}`, `${col+1}${row}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)-1)}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)+1)}`
    ].filter(n => lobbyInfo.board_state.includes(n) && !lobbyInfo.tile_ownership[n]);
    
    const newOwnership = { ...lobbyInfo.tile_ownership };
    [lastTile, ...cluster].forEach(t => { newOwnership[t] = corp; });

    await supabase.from('players').update({ stocks: updatedStocks }).eq('id', me.id);
    await supabase.from('lobbies').update({ 
      active_chains: [...lobbyInfo.active_chains, corp], 
      chain_sizes: { ...lobbyInfo.chain_sizes, [corp]: cluster.length + 1 }, 
      tile_ownership: newOwnership, 
      available_stocks: { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks[corp] || 25) - 1 }, 
      turn_phase: 'buy_stocks' 
    }).eq('id', lobbyInfo.id);
  };

  const handleBuyStock = async (corp: string) => {
    if (!lobbyInfo || !me) return;
    const price = getStockPrice(corp, lobbyInfo.chain_sizes[corp] || 0);
    const available = lobbyInfo.available_stocks[corp] || 0;
    
    if (me.money < price || stocksBoughtThisTurn >= 3 || available <= 0) return;
    
    const updatedStocks = { ...(me.stocks || {}), [corp]: ((me.stocks || {})[corp] || 0) + 1 };
    setStocksBoughtThisTurn(prev => prev + 1);
    
    await supabase.from('players').update({ 
      money: me.money - price, 
      stocks: updatedStocks 
    }).eq('id', me.id);
    
    await supabase.from('lobbies').update({ 
      available_stocks: { ...lobbyInfo.available_stocks, [corp]: available - 1 } 
    }).eq('id', lobbyInfo.id);
  };

  const handleDisposition = async (sellAmt: number, tradePrs: number) => {
    if (!lobbyInfo || !me) return;
    const { survivor, current_defunct, defunct_corps, tile_placed } = lobbyInfo.merger_data;
    
    let m = me.money;
    let s = { ...me.stocks };

    // Calculate money gained from selling specific amounts
    if (sellAmt > 0) {
      m += sellAmt * getStockPrice(current_defunct!, lobbyInfo.chain_sizes[current_defunct!]);
    }
    
    // Deduct total disposed stocks and add new survivor stocks
    s[current_defunct!] -= (sellAmt + (tradePrs * 2));
    if (tradePrs > 0) {
      s[survivor!] = (s[survivor!] || 0) + tradePrs;
    }

    // --- MARKET RESUPPLY LOGIC ---
    let updatedAvailable = { ...lobbyInfo.available_stocks };
    // Add defunct shares back to the bank
    updatedAvailable[current_defunct!] = (updatedAvailable[current_defunct!] || 0) + sellAmt + (tradePrs * 2);
    // Remove traded survivor shares from the bank
    updatedAvailable[survivor!] = Math.max(0, (updatedAvailable[survivor!] || 0) - tradePrs);

    const activePlayers = players.filter(p => !p.is_spectator);
    const nextIdx = (lobbyInfo.disposition_turn_index + 1) % activePlayers.length;

    // Reset local UI state for the next merger
    setSellCount(0);
    setTradePairs(0);

    // Build a single database payload
    let lobbyPayload: any = {
      disposition_turn_index: nextIdx,
      available_stocks: updatedAvailable
    };

    if (nextIdx === lobbyInfo.current_turn_index) {
      const updatedOwnership = { ...lobbyInfo.tile_ownership };
      Object.keys(updatedOwnership).forEach(k => {
        if (updatedOwnership[k] === current_defunct) updatedOwnership[k] = survivor!;
      });
      
      const remainingDefuncts = defunct_corps?.filter(c => c !== current_defunct) || [];
      
      if (remainingDefuncts.length > 0) {
        await distributeBonuses(remainingDefuncts[0], lobbyInfo.chain_sizes[remainingDefuncts[0]]);
        lobbyPayload = {
          ...lobbyPayload,
          merger_data: { ...lobbyInfo.merger_data, current_defunct: remainingDefuncts[0], defunct_corps: remainingDefuncts },
          disposition_turn_index: lobbyInfo.current_turn_index,
          tile_ownership: updatedOwnership,
          active_chains: lobbyInfo.active_chains.filter(c => c !== current_defunct),
          chain_sizes: {
            ...lobbyInfo.chain_sizes,
            [survivor!]: (lobbyInfo.chain_sizes[survivor!] || 0) + (lobbyInfo.chain_sizes[current_defunct!] || 0)
          }
        };
      } else {
        updatedOwnership[tile_placed!] = survivor!;
        lobbyPayload = {
          ...lobbyPayload,
          turn_phase: 'buy_stocks',
          tile_ownership: updatedOwnership,
          active_chains: lobbyInfo.active_chains.filter(c => c !== current_defunct),
          chain_sizes: {
            ...lobbyInfo.chain_sizes,
            [survivor!]: (lobbyInfo.chain_sizes[survivor!] || 0) + (lobbyInfo.chain_sizes[current_defunct!] || 0) + 1
          }
        };
      }
    }
    
    // Execute database sync
    await supabase.from('players').update({ money: m, stocks: s }).eq('id', me.id);
    await supabase.from('lobbies').update(lobbyPayload).eq('id', lobbyInfo.id);
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

  const handleSwapTile = async (tile: string) => {
    if (!lobbyInfo || !me) return;
    const pool = [...lobbyInfo.tile_pool];
    if (pool.length === 0) return;
    const newTile = pool.pop();
    const newHand = me.hand.filter(t => t !== tile);
    if (newTile) newHand.push(newTile);
    await supabase.from('players').update({ hand: newHand }).eq('id', me.id);
    await supabase.from('lobbies').update({ tile_pool: pool }).eq('id', lobbyInfo.id);
  };

  const handleEndGame = async () => {
    if (!lobbyInfo) return;
    for (const corp of lobbyInfo.active_chains) {
      await distributeBonuses(corp, lobbyInfo.chain_sizes[corp]);
    }
    const { data: finalP } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id);
    if (!finalP) return;
    for (const p of finalP) {
      let finalCash = p.money;
      CORPORATIONS.forEach(c => {
        if (p.stocks[c] > 0) finalCash += p.stocks[c] * getStockPrice(c, lobbyInfo.chain_sizes[c]);
      });
      await supabase.from('players').update({ money: finalCash, stocks: {} }).eq('id', p.id);
    }
    await supabase.from('lobbies').update({ status: 'finished' }).eq('id', lobbyInfo.id);
  };

  // --- RENEGADE START (ADJACENCY LOGIC) ---
  const handleStartGame = async () => {
    if (!lobbyInfo) return;
    const active = players.filter(p => !p.is_spectator);
    let pool: string[] = [];
    for (const r of BOARD_ROWS) {
      for (const c of BOARD_COLS) {
        pool.push(`${c}${r}`);
      }
    }

    let drawResults: { id: string, tile: string }[] = [];
    let isValidStart = false;

    while (!isValidStart) {
      pool = pool.sort(() => Math.random() - 0.5);
      const tempPool = [...pool];
      drawResults = active.map(p => ({ id: p.id, tile: tempPool.pop()! }));

      let hasAdjacency = false;
      for (let i = 0; i < drawResults.length; i++) {
        const t1 = drawResults[i].tile;
        const col1 = parseInt(t1.match(/\d+/)?.[0] || '0');
        const row1 = t1.match(/[A-I]/)?.[0] || 'A';

        for (let j = i + 1; j < drawResults.length; j++) {
          const t2 = drawResults[j].tile;
          const col2 = parseInt(t2.match(/\d+/)?.[0] || '0');
          const row2 = t2.match(/[A-I]/)?.[0] || 'A';
          const isAdj = (col1 === col2 && Math.abs(row1.charCodeAt(0) - row2.charCodeAt(0)) === 1) || (row1 === row2 && Math.abs(col1 - col2) === 1);
          if (isAdj) { hasAdjacency = true; break; }
        }
        if (hasAdjacency) break;
      }
      if (!hasAdjacency) {
        isValidStart = true;
        pool = tempPool;
      } else {
        console.log("Renegade Adjacency detected. Reshuffling tactical assets...");
      }
    }

    drawResults.sort((a, b) => getTileValue(a.tile) - getTileValue(b.tile));
    for (let i = 0; i < drawResults.length; i++) {
      await supabase.from('players').update({
        play_order: i,
        starting_tile: drawResults[i].tile,
        hand: pool.splice(-6)
      }).eq('id', drawResults[i].id);
    }

    await supabase.from('lobbies').update({
      status: 'playing',
      board_state: drawResults.map(r => r.tile),
      tile_pool: pool
    }).eq('id', lobbyInfo.id);
  };

  // --- LOBBY JOIN/CREATE ---
  const handleJoinLobby = async (e: any) => {
    e.preventDefault();
    if (!playerName || !joinCodeInput) return;
    const { data: l } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (l) {
      const { count } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('lobby_id', l.id);
      const { error } = await supabase.from('players').insert([{
        lobby_id: l.id,
        player_name: playerName,
        is_host: false,
        is_spectator: (count || 0) >= 6,
        money: 6000,
        stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}),
        hand: []
      }]);
      if (!error) setLobbyInfo(l as Lobby);
      else alert("Encryption Error.");
    } else alert("Invalid Frequency.");
  };

  const handleCreateLobby = async (e: any) => {
    e.preventDefault();
    if (!playerName) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: l } = await supabase.from('lobbies').insert([{
      join_code: code,
      status: 'waiting',
      turn_phase: 'place_tile',
      current_turn_index: 0,
      board_state: [],
      active_chains: [],
      chain_sizes: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}),
      tile_ownership: {},
      available_stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 25 }), {}),
      tile_pool: []
    }]).select().single();
    
    if (l) {
      await supabase.from('players').insert([{
        lobby_id: l.id,
        player_name: playerName,
        is_host: true,
        money: 6000,
        stocks: CORPORATIONS.reduce((a, c) => ({ ...a, [c]: 0 }), {}),
        hand: []
      }]);
      setLobbyInfo(l as Lobby);
      setIsHost(true);
    }
  };

  // --- TACTICAL SCANNER ---
  const getTileLegality = (tile: string) => {
    if (!lobbyInfo) return 'valid';
    const col = parseInt(tile.match(/\d+/)?.[0] || '0');
    const row = tile.match(/[A-I]/)?.[0] || 'A';
    
    const adj = [
      `${col-1}${row}`, `${col+1}${row}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)-1)}`, 
      `${col}${String.fromCharCode(row.charCodeAt(0)+1)}`
    ].filter(n => lobbyInfo.board_state.includes(n));

    const neighboringCorps = Array.from(new Set(adj.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c)));
    const safeCorps = neighboringCorps.filter(c => (lobbyInfo.chain_sizes[c] || 0) >= 11);
    
    if (safeCorps.length >= 2) return 'permanently_unplayable';
    if (neighboringCorps.length === 0 && adj.length > 0 && lobbyInfo.active_chains.length >= 7) return 'temporarily_unplayable';
    return 'valid';
  };

  // --- STAT CALCULATIONS ---
  const activeChains = lobbyInfo?.active_chains || [];
  const chainSizes = lobbyInfo?.chain_sizes || {};
  
  const netWorth = me ? (me.money + CORPORATIONS.reduce((acc, c) => acc + ((me.stocks[c] || 0) * getStockPrice(c, chainSizes[c] || 0)), 0)) : 0;
  
  // FIXED END GAME CONDITION: 
  // Game ends if ANY active corp is 41+ OR if ALL active corps are Safe (11+)
  const canEndGame = activeChains.length > 0 && (
    activeChains.some(c => (chainSizes[c] || 0) >= 41) || 
    activeChains.every(c => (chainSizes[c] || 0) >= 11)
  );
  
  const isPoolLow = (lobbyInfo?.tile_pool?.length || 0) <= 10 && lobbyInfo?.status === 'playing';

  // --- RENDERING ---
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans uppercase">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-50 sticky top-0 shadow-lg">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-black text-amber-500 italic tracking-tighter">Syndicate Terminal</h1>
          {isPoolLow && (
            <div className="hidden md:flex items-center gap-2 bg-rose-500/10 border border-rose-500/50 px-3 py-1 rounded-full animate-pulse">
              <span className="w-2 h-2 bg-rose-500 rounded-full"></span>
              <span className="text-[9px] font-black text-rose-500 tracking-widest uppercase">Stock Depleted: {lobbyInfo?.tile_pool?.length} Left</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={toggleVoice} className={`text-[9px] px-3 py-1 rounded-full border transition-all ${isMicActive ? 'bg-emerald-500 text-black border-emerald-400 animate-pulse' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
            {isMicActive ? '🎙 Comms Active' : '🎤 Mic Muted'}
          </button>
          {lobbyInfo?.status === 'playing' && canEndGame && me?.play_order === lobbyInfo.current_turn_index && (
            <button onClick={handleEndGame} className="bg-rose-600 px-4 py-1 rounded-full font-black text-[9px] border border-rose-400 hover:bg-rose-500 transition-colors">Terminate Mission</button>
          )}
          {lobbyInfo && <span className="text-[10px] font-mono bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-full border border-amber-500/20">{lobbyInfo.join_code}</span>}
        </div>
      </header>

      <div className="flex-grow overflow-hidden relative">
        {lobbyInfo?.status === 'finished' ? (
          <div className="flex flex-col items-center justify-center p-6 h-full animate-in fade-in zoom-in duration-500">
            <h2 className="text-5xl font-black text-amber-500 mb-8 italic tracking-tighter">Asset Liquidation Standings</h2>
            <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 w-full max-w-md space-y-4 shadow-2xl">
              {[...players].sort((a, b) => b.money - a.money).map((p, i) => (
                <div key={p.id} className={`flex justify-between items-center p-5 rounded-2xl border transition-all ${i === 0 ? 'border-amber-500 bg-amber-500/10 scale-105' : 'border-slate-800 bg-slate-800/50'}`}>
                  <span className="font-black text-lg">#{i + 1} {p.player_name}</span>
                  <span className="font-mono text-emerald-400 font-bold">${p.money.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <button onClick={() => window.location.reload()} className="mt-10 bg-amber-500 text-black px-8 py-3 rounded-xl font-black uppercase hover:bg-amber-400 transition-colors">Return to Base</button>
          </div>
        ) : !lobbyInfo ? (
          <div className="max-w-md mx-auto pt-20 px-6 space-y-4">
            <div className="text-center mb-10">
              <p className="text-[10px] text-amber-500 font-black tracking-[0.3em] mb-2">Authenticated Connection Required</p>
              <h2 className="text-4xl font-black italic tracking-tighter text-slate-100">Establish Link</h2>
            </div>
            <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 uppercase transition-all" placeholder="Agent Pseudonym" />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setView('create')} className={`font-black p-4 rounded-xl uppercase transition-all ${view === 'create' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400'}`}>Create</button>
              <button onClick={() => setView('join')} className={`font-black p-4 rounded-xl uppercase transition-all ${view === 'join' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400'}`}>Join</button>
            </div>
            {view === 'join' && <input type="text" value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-900 p-4 rounded-xl border border-slate-800 text-center font-mono uppercase focus:border-amber-500 outline-none transition-all" placeholder="HEX CODE" />}
            {(view === 'join' || view === 'create') && playerName && (
              <button onClick={view === 'create' ? handleCreateLobby : handleJoinLobby} className="w-full bg-emerald-500 text-white font-black p-4 rounded-xl uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20">Authorize Transmission</button>
            )}
          </div>
        ) : lobbyInfo.status === 'waiting' ? (
          <div className="text-center pt-20 animate-in fade-in duration-700">
            <p className="text-[10px] text-slate-500 font-black tracking-widest mb-4">Frequency Established</p>
            <h2 className="text-7xl font-mono text-amber-400 mb-10 tracking-tighter border-y border-slate-800 py-6 inline-block px-12">{lobbyInfo.join_code}</h2>
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 w-80 mx-auto space-y-2 mb-10 shadow-xl">
              <p className="text-[8px] text-slate-600 font-black mb-4 tracking-widest">Active Operatives</p>
              {players.map(p => <div key={p.id} className="text-sm font-bold flex justify-between uppercase py-1"><span>{p.player_name}</span> {p.is_host && <span className="text-amber-500 text-[10px]">HOST</span>}</div>)}
            </div>
            {isHost && players.length >= 3 && <button onClick={handleStartGame} className="bg-emerald-500 px-12 py-4 rounded-2xl font-black text-white shadow-xl shadow-emerald-500/20 uppercase tracking-widest hover:scale-105 transition-all">Initiate Operations</button>}
          </div>
        ) : (
          <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-6 lg:p-6 overflow-hidden">
            {/* --- MAIN THEATER --- */}
            <div className={`lg:col-span-8 p-4 lg:p-6 bg-slate-900 lg:rounded-3xl border border-slate-800 overflow-auto flex flex-col relative shadow-inner ${mobileTab !== 'board' ? 'hidden lg:flex' : 'flex'}`}>
              
              {/* FOUNDING OVERLAY */}
              {lobbyInfo.turn_phase === 'found_chain' && me?.play_order === lobbyInfo.current_turn_index && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-40 flex items-center justify-center p-4">
                  <div className="bg-slate-900 p-8 rounded-3xl border border-amber-500 shadow-2xl text-center max-w-sm w-full">
                    <h3 className="font-black text-amber-500 mb-2 uppercase tracking-widest">Establish Infrastructure</h3>
                    <p className="text-[9px] text-slate-500 mb-6 font-bold uppercase tracking-widest">Select an available syndicate to represent this expansion</p>
                    <div className="grid grid-cols-2 gap-3">
                      {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(c => (
                        <button key={c} onClick={() => handleFoundChain(c)} className={`${CORP_METADATA[c].bg} p-4 rounded-xl font-black text-[10px] uppercase shadow-lg hover:brightness-125 transition-all`}>{c}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* MERGER OVERLAY */}
              {lobbyInfo.turn_phase === 'merger_resolution' && players[lobbyInfo.disposition_turn_index]?.player_name === playerName && (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) > 0 && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-40 flex items-center justify-center p-4">
                  <div className="bg-slate-900 p-8 rounded-3xl border border-emerald-500 shadow-2xl text-center max-w-sm w-full">
                    <h3 className="font-black text-emerald-400 mb-1 uppercase tracking-widest">Hostile Acquisition</h3>
                    <p className="text-[9px] text-slate-400 font-bold mb-4 uppercase tracking-widest">{lobbyInfo.merger_data.current_defunct} is being liquidated</p>
                    
                    <div className="bg-slate-800 p-4 rounded-xl mb-6 border border-slate-700">
                       <p className="text-xs font-bold text-slate-300 mb-4">Your Shares: <span className="text-amber-500 text-lg">{me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0}</span></p>
                       
                       {/* Sell Controls */}
                       <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400">Sell ($)</span>
                          <div className="flex gap-2 items-center">
                              <button onClick={() => setSellCount(Math.max(0, sellCount - 1))} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 transition-colors">-</button>
                              <span className="w-6 font-mono font-bold text-center">{sellCount}</span>
                              <button onClick={() => setSellCount(sellCount + 1)} disabled={sellCount + (tradePairs * 2) >= (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0)} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">+</button>
                          </div>
                       </div>

                       {/* Trade Controls */}
                       <div className="flex justify-between items-center mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Trade (2:1 for {lobbyInfo.merger_data.survivor})</span>
                          <div className="flex gap-2 items-center">
                              <button onClick={() => setTradePairs(Math.max(0, tradePairs - 1))} className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 transition-colors">-</button>
                              <span className="w-6 font-mono font-bold text-center">{tradePairs}</span>
                              <button 
                                onClick={() => setTradePairs(tradePairs + 1)} 
                                disabled={
                                  sellCount + ((tradePairs + 1) * 2) > (me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) || 
                                  (tradePairs + 1) > (lobbyInfo.available_stocks[lobbyInfo.merger_data.survivor!] || 0)
                                } 
                                className="bg-slate-700 w-7 h-7 rounded-md font-black hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                +
                              </button>
                          </div>
                       </div>

                       {/* Keep Display */}
                       <div className="flex justify-between items-center mt-4 border-t border-slate-700 pt-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Keep</span>
                          <span className="font-mono text-emerald-400 font-black text-lg">{(me?.stocks[lobbyInfo.merger_data.current_defunct!] || 0) - sellCount - (tradePairs * 2)}</span>
                       </div>
                    </div>

                    <button onClick={() => handleDisposition(sellCount, tradePairs)} className="w-full bg-emerald-600 text-white font-black py-4 rounded-xl uppercase hover:bg-emerald-500 transition-all shadow-lg tracking-widest">Execute Strategy</button>
                  </div>
                </div>
              )}

              {/* GRID */}
              <div className="grid grid-cols-12 gap-1 mb-8 p-1 bg-slate-950/50 rounded-xl border border-slate-800/50">
                {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                  const id = `${c}${r}`;
                  const owner = lobbyInfo.tile_ownership[id];
                  const isPlaced = lobbyInfo.board_state.includes(id);
                  const isSafe = owner && (lobbyInfo.chain_sizes[owner] || 0) >= 11;
                  return (
                    <div key={id} className={`aspect-square flex flex-col items-center justify-center rounded-md text-[8px] lg:text-[10px] font-bold border transition-all duration-300 ${isPlaced ? (owner ? `${CORP_METADATA[owner].bg} border-white/30 shadow-[0_0_15px_rgba(255,255,255,0.1)]` : 'bg-amber-500 text-black border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)] scale-95') : 'bg-slate-800/20 text-slate-700 border-slate-800/40'}`}>
                      {id} {isSafe && <span className="text-[7px] mt-0.5 animate-pulse">🛡️</span>}
                    </div>
                  );
                }))}
              </div>

              {/* HAND TACTICAL SCANNER */}
              <div className="flex justify-center gap-2 mt-auto pb-4">
                {me?.hand?.map((t: string) => {
                  const legality = getTileLegality(t);
                  const isMyTurn = lobbyInfo.current_turn_index === me?.play_order;
                  const isPlacePhase = lobbyInfo.turn_phase === 'place_tile';
                  
                  return (
                    <div key={t} className="relative group">
                      <button 
                        onClick={() => handlePlaceTile(t)} 
                        disabled={!isMyTurn || !isPlacePhase || legality !== 'valid'} 
                        className={`w-12 h-12 lg:w-16 lg:h-16 font-black rounded-xl shadow-2xl transition-all uppercase relative overflow-hidden flex items-center justify-center
                          ${legality === 'valid' ? 'bg-amber-500 text-black hover:scale-110 active:scale-95 disabled:opacity-20' : ''}
                          ${legality === 'temporarily_unplayable' ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed' : ''}
                          ${legality === 'permanently_unplayable' ? 'bg-rose-950/50 text-rose-500 border border-rose-500/30' : ''}
                        `}
                      >
                        <span className="z-10">{t}</span>
                        {legality === 'permanently_unplayable' && isMyTurn && isPlacePhase && (
                          <div onClick={(e) => { e.stopPropagation(); handleSwapTile(t); }} className="absolute inset-0 bg-rose-600 text-white flex items-center justify-center text-[7px] font-black opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">SWAP TILE</div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-50" />
                      </button>
                      {legality !== 'valid' && (
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black/90 text-[7px] px-3 py-1.5 rounded-lg border border-slate-800 opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none transition-all shadow-xl">
                          {legality === 'permanently_unplayable' ? 'ILLEGAL MERGER: SAFE CHAINS' : 'FOUNDING CAP REACHED (MAX 7)'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* --- INTELLIGENCE PANEL --- */}
            <div className={`lg:col-span-4 flex flex-col gap-4 overflow-y-auto pb-24 lg:pb-0 ${mobileTab !== 'market' ? 'hidden lg:flex' : 'flex'}`}>
              
              <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-lg">
                <h3 className="text-[9px] font-black text-slate-500 mb-3 uppercase tracking-widest">Draw Ceremony Results</h3>
                <div className="space-y-1">
                  {players.map(p => (
                    <div key={p.id} className={`flex justify-between items-center px-4 py-2.5 rounded-xl border transition-all ${p.play_order === lobbyInfo.current_turn_index ? 'border-amber-500 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'border-transparent bg-slate-800/50'}`}>
                      <span className="text-xs font-bold uppercase tracking-tight">{p.player_name}</span>
                      <span className="text-[9px] font-black bg-slate-950 px-3 py-1.5 rounded-lg text-amber-500 font-mono tracking-tighter shadow-inner border border-slate-800 uppercase">{p.starting_tile}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-3xl border border-amber-500/20 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                   <span className="text-4xl font-black italic">ASSET</span>
                </div>
                <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase border-b border-slate-800 pb-2 tracking-widest">Portfolio Matrix</h3>
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Available Liquidity</p>
                    <p className="text-3xl font-black text-emerald-400 font-mono tracking-tighter">${me?.money.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total Net Worth</p>
                    <p className="text-sm font-bold font-mono text-slate-100">${netWorth.toLocaleString()}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CORPORATIONS.map(c => (
                    <div key={c} className={`flex justify-between items-center text-[10px] font-bold p-3 rounded-xl border transition-all ${me?.stocks[c] ? 'bg-slate-800 border-slate-700 opacity-100' : 'bg-slate-900/50 border-transparent opacity-20 grayscale'}`}>
                      <span className="uppercase tracking-tighter">{c}</span>
                      <span className="font-mono text-amber-500 bg-black/40 px-2 py-0.5 rounded-md shadow-inner">{me?.stocks[c] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl flex-grow flex flex-col">
                <h3 className="text-[10px] font-black text-slate-500 mb-4 uppercase tracking-widest">Market Exchange</h3>
                <div className="space-y-2 flex-grow overflow-auto pr-2">
                  {CORPORATIONS.map(c => {
                    const size = lobbyInfo.chain_sizes[c] || 0;
                    const active = lobbyInfo.active_chains.includes(c);
                    const price = getStockPrice(c, size);
                    const canBuy = active && (lobbyInfo.current_turn_index === me?.play_order) && (stocksBoughtThisTurn < 3) && ((me?.money || 0) >= price) && ((lobbyInfo.available_stocks[c] || 0) > 0);
                    
                    return (
                      <div key={c} className={`w-full flex justify-between items-center p-3 rounded-xl font-black text-[11px] border transition-all ${active ? 'bg-slate-800 border-slate-700 shadow-md' : 'opacity-10 border-transparent grayscale'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-1 h-6 rounded-full ${CORP_METADATA[c].bg}`} />
                          <div className="flex flex-col">
                            <span className="tracking-tight">{c}</span>
                            <span className="text-[8px] text-slate-500">SIZE: {size} | AVAIL: {lobbyInfo.available_stocks[c]}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-emerald-400 font-mono text-sm">${price}</span>
                          <button onClick={() => handleBuyStock(c)} disabled={!canBuy} className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest shadow-md transition-all ${canBuy ? 'bg-amber-500 text-black hover:bg-amber-400 active:scale-90' : 'bg-slate-950 text-slate-700 cursor-not-allowed opacity-0'}`}>Buy</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {lobbyInfo.current_turn_index === me?.play_order && lobbyInfo.turn_phase === 'buy_stocks' && (
                  <button onClick={handleEndTurn} className="w-full bg-emerald-600 py-5 rounded-2xl font-black text-[11px] mt-6 uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/10 flex justify-center items-center gap-3 hover:bg-emerald-500 transition-all active:scale-95 group">
                    <span>COMMIT & TRANSMIT MOVE</span>
                    <span className="bg-black/20 px-3 py-1 rounded-lg text-[9px] font-mono group-hover:bg-black/30">({stocksBoughtThisTurn}/3)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE NAV TABS */}
      {lobbyInfo?.status === 'playing' && (
        <nav className="lg:hidden h-20 bg-slate-900 border-t border-slate-800 grid grid-cols-2 items-center z-50 fixed bottom-0 left-0 right-0 shadow-2xl">
          <button onClick={() => setMobileTab('board')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'board' ? 'text-amber-500' : 'text-slate-600'}`}>
            <span className="text-2xl font-black">◫</span>
            <span className="text-[8px] font-black tracking-widest">TACTICAL GRID</span>
          </button>
          <button onClick={() => setMobileTab('market')} className={`flex flex-col items-center gap-1 transition-all ${mobileTab === 'market' ? 'text-amber-500' : 'text-slate-600'}`}>
            <span className="text-2xl font-black">＄</span>
            <span className="text-[8px] font-black tracking-widest">MARKET EXCHANGE</span>
          </button>
        </nav>
      )}
    </main>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// --- CONSTANTS & UTILITIES ---
const CORPORATIONS = ['Sackson', 'Festival', 'Tower', 'American', 'Worldwide', 'Imperial', 'Continental'];
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const getTileValue = (tile: string) => {
  const number = parseInt(tile.match(/\d+/)?.[0] || '0');
  const letter = tile.match(/[A-I]/)?.[0] || 'A';
  const letterValue = letter.charCodeAt(0) - 65; 
  return (letterValue * 100) + number;
};

const getStockPrice = (corp: string, size: number) => {
  const effectiveSize = size < 2 ? 2 : size; 
  let basePrice = 0;
  if (['Sackson', 'Tower'].includes(corp)) basePrice = 200;
  else if (['Festival', 'Worldwide', 'American'].includes(corp)) basePrice = 300;
  else if (['Imperial', 'Continental'].includes(corp)) basePrice = 400;

  let tierBonus = 0;
  if (effectiveSize === 3) tierBonus = 100;
  else if (effectiveSize === 4) tierBonus = 200;
  else if (effectiveSize === 5) tierBonus = 300;
  else if (effectiveSize >= 6 && effectiveSize <= 10) tierBonus = 400;
  else if (effectiveSize >= 11 && effectiveSize <= 20) tierBonus = 500;
  else if (effectiveSize >= 21 && effectiveSize <= 30) tierBonus = 600;
  else if (effectiveSize >= 31 && effectiveSize <= 40) tierBonus = 700;
  else if (effectiveSize >= 41) tierBonus = 800;

  return basePrice + tierBonus;
};

// --- TYPES ---
type Player = { 
  id: string; 
  player_name: string; 
  is_host: boolean;
  money: number;
  starting_tile?: string;
  hand: string[];
  play_order: number;
  stocks: Record<string, number>;
};

type Lobby = { 
  id: string; 
  name: string; 
  code: string; 
  status: string; 
  board_state: string[];
  tile_pool: string[];
  current_turn_index: number;
  turn_phase: string;
  available_stocks: Record<string, number>;
  active_chains: string[];
  chain_sizes: Record<string, number>;
  tile_ownership: Record<string, string | null>;
  merger_data: any; 
  disposition_turn_index?: number;
};

export default function Home() {
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  useEffect(() => {
    if (!lobbyInfo) return;
    const fetchInitialData = async () => {
      const { data: pData } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      if (pData) setPlayers(pData as Player[]);
      const { data: lData } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      if (lData) setLobbyInfo(prev => prev ? { ...prev, ...lData } : null);
    };
    fetchInitialData();

    const lobbyChannel = supabase.channel('lobby-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, 
        (payload) => setLobbyInfo((current) => current ? { ...current, ...payload.new } : null)
      ).subscribe();

    const playerChannel = supabase.channel('player-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setPlayers((current) => [...current, payload.new as Player]);
          else if (payload.eventType === 'UPDATE') setPlayers((current) => current.map(p => p.id === payload.new.id ? payload.new as Player : p));
        }
      ).subscribe();

    return () => { supabase.removeChannel(lobbyChannel); supabase.removeChannel(playerChannel); };
  }, [lobbyInfo?.id]);

  const getNeighbors = (tile: string) => {
    const col = parseInt(tile.match(/\d+/)?.[0] || '0');
    const row = tile.match(/[A-I]/)?.[0] || 'A';
    const rowIndex = BOARD_ROWS.indexOf(row);
    const neighbors = [];
    if (col > 1) neighbors.push(`${col - 1}${row}`);
    if (col < 12) neighbors.push(`${col + 1}${row}`);
    if (rowIndex > 0) neighbors.push(`${col}${BOARD_ROWS[rowIndex - 1]}`);
    if (rowIndex < 8) neighbors.push(`${col}${BOARD_ROWS[rowIndex + 1]}`);
    return neighbors;
  };

  const calculateMergerBonuses = (defunctCorp: string, currentPlayers: Player[]) => {
    const defunctPrice = getStockPrice(defunctCorp, lobbyInfo!.chain_sizes[defunctCorp]);
    const primaryBonus = defunctPrice * 10;
    const secondaryBonus = defunctPrice * 5;

    const sortedHolders = [...currentPlayers].sort((a, b) => (b.stocks[defunctCorp] || 0) - (a.stocks[defunctCorp] || 0));
    const topCount = sortedHolders[0].stocks[defunctCorp] || 0;

    if (topCount === 0) return [];

    const primaryHolders = sortedHolders.filter(p => p.stocks[defunctCorp] === topCount);
    const updates: {id: string, money: number}[] = [];

    if (primaryHolders.length > 1) {
      const splitAmount = Math.ceil((primaryBonus + secondaryBonus) / primaryHolders.length / 100) * 100;
      primaryHolders.forEach(p => updates.push({ id: p.id, money: p.money + splitAmount }));
    } else {
      updates.push({ id: primaryHolders[0].id, money: primaryHolders[0].money + primaryBonus });
      const remainingHolders = sortedHolders.filter(p => p.id !== primaryHolders[0].id);
      const secondaryCount = remainingHolders[0]?.stocks[defunctCorp] || 0;
      if (secondaryCount > 0) {
        const secondaryHolders = remainingHolders.filter(p => p.stocks[defunctCorp] === secondaryCount);
        const splitSecondary = Math.ceil(secondaryBonus / secondaryHolders.length / 100) * 100;
        secondaryHolders.forEach(p => updates.push({ id: p.id, money: p.money + splitSecondary }));
      }
    }
    return updates;
  };

  const handlePlaceTile = async (tileToPlace: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;

    const neighbors = getNeighbors(tileToPlace);
    const adjacentPlacedTiles = neighbors.filter(n => lobbyInfo.board_state.includes(n));
    const adjacentCorps = adjacentPlacedTiles.map(n => lobbyInfo.tile_ownership[n]).filter((corp): corp is string => !!corp);
    const uniqueAdjacentCorps = Array.from(new Set(adjacentCorps));

    const safeAdjacentCorps = uniqueAdjacentCorps.filter(corp => (lobbyInfo.chain_sizes[corp] || 0) >= 11);
    if (safeAdjacentCorps.length > 1) {
      alert("Illegal Move: You cannot merge two safe chains.");
      return;
    }

    let nextPhase = 'buy_stocks';
    let updatedOwnership = { ...lobbyInfo.tile_ownership, [tileToPlace]: null as string | null };
    let mergerData = lobbyInfo.merger_data || {};

    if (uniqueAdjacentCorps.length > 1) {
      nextPhase = 'merger_resolution';
      const sortedBySize = [...uniqueAdjacentCorps].sort((a, b) => lobbyInfo.chain_sizes[b] - lobbyInfo.chain_sizes[a]);
      const maxSize = lobbyInfo.chain_sizes[sortedBySize[0]];
      const potentialSurvivors = sortedBySize.filter(c => lobbyInfo.chain_sizes[c] === maxSize);

      mergerData = {
        defunct_corps: uniqueAdjacentCorps, // Will be filtered after survivor is picked
        potential_survivors: potentialSurvivors,
        tile_placed: tileToPlace,
        mergemaker_id: currentPlayer.id,
        is_tied: potentialSurvivors.length > 1
      };

      if (!mergerData.is_tied) {
        const survivor = potentialSurvivors[0];
        const defunct = uniqueAdjacentCorps.find(c => c !== survivor)!;
        const payouts = calculateMergerBonuses(defunct, players);
        for (const payout of payouts) {
           await supabase.from('players').update({ money: payout.money }).eq('id', payout.id);
        }
        mergerData = { ...mergerData, survivor, current_defunct: defunct };
      }
    } 
    else if (uniqueAdjacentCorps.length === 1) {
      const corp = uniqueAdjacentCorps[0];
      updatedOwnership[tileToPlace] = corp;
      const newSizes = { ...lobbyInfo.chain_sizes, [corp]: (lobbyInfo.chain_sizes[corp] || 0) + 1 };
      await supabase.from('lobbies').update({ chain_sizes: newSizes }).eq('id', lobbyInfo.id);
    }
    else if (adjacentPlacedTiles.length > 0 && uniqueAdjacentCorps.length === 0) {
      nextPhase = 'found_chain';
    }

    const newHand = currentPlayer.hand.filter(t => t !== tileToPlace);
    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ 
      board_state: [...lobbyInfo.board_state, tileToPlace], 
      tile_ownership: updatedOwnership, 
      turn_phase: nextPhase,
      merger_data: mergerData,
      disposition_turn_index: lobbyInfo.current_turn_index 
    }).eq('id', lobbyInfo.id);
  };

  // --- NEW: Handle Tie Breaker Selection ---
  const handleSelectSurvivor = async (survivor: string) => {
    if (!lobbyInfo) return;
    const defunct = lobbyInfo.merger_data.defunct_corps.find((c: string) => c !== survivor);
    
    const payouts = calculateMergerBonuses(defunct, players);
    for (const payout of payouts) {
       await supabase.from('players').update({ money: payout.money }).eq('id', payout.id);
    }

    await supabase.from('lobbies').update({
      merger_data: {
        ...lobbyInfo.merger_data,
        survivor,
        current_defunct: defunct,
        is_tied: false
      }
    }).eq('id', lobbyInfo.id);
  };

  const handleFoundChain = async (corp: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;
    const lastPlaced = lobbyInfo.board_state[lobbyInfo.board_state.length - 1];
    const neighbors = getNeighbors(lastPlaced);
    const adjacentUnowned = neighbors.filter(n => lobbyInfo.board_state.includes(n) && !lobbyInfo.tile_ownership?.[n]);
    const newlyOwnedTiles = [lastPlaced, ...adjacentUnowned];
    const updatedOwnership = { ...lobbyInfo.tile_ownership };
    newlyOwnedTiles.forEach(tile => updatedOwnership[tile] = corp);
    const newPlayerStocks = { ...currentPlayer.stocks, [corp]: (currentPlayer.stocks[corp] || 0) + 1 };
    const newLobbyStocks = { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks[corp] || 0) - 1 };
    const newActiveChains = [...(lobbyInfo.active_chains || []), corp];
    const newSizes = { ...lobbyInfo.chain_sizes, [corp]: newlyOwnedTiles.length };
    await supabase.from('players').update({ stocks: newPlayerStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ tile_ownership: updatedOwnership, active_chains: newActiveChains, chain_sizes: newSizes, available_stocks: newLobbyStocks, turn_phase: 'buy_stocks' }).eq('id', lobbyInfo.id);
  };

  const handleBuyStock = async (corp: string) => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName || stocksBoughtThisTurn >= 3) return;
    const price = getStockPrice(corp, lobbyInfo.chain_sizes[corp] || 0); 
    if (currentPlayer.money < price) return;
    if ((lobbyInfo.available_stocks[corp] || 0) <= 0) return;
    const newMoney = currentPlayer.money - price;
    const newPlayerStocks = { ...currentPlayer.stocks, [corp]: (currentPlayer.stocks[corp] || 0) + 1 };
    const newLobbyStocks = { ...lobbyInfo.available_stocks, [corp]: (lobbyInfo.available_stocks[corp] || 0) - 1 };
    setStocksBoughtThisTurn(prev => prev + 1);
    await supabase.from('players').update({ money: newMoney, stocks: newPlayerStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ available_stocks: newLobbyStocks }).eq('id', lobbyInfo.id);
  };

  const handleDisposition = async (action: 'sell' | 'trade' | 'keep', count: number) => {
    if (!lobbyInfo) return;
    const currentPlayer = players.find(p => p.play_order === lobbyInfo.disposition_turn_index);
    if (currentPlayer?.player_name !== playerName) return;

    const defunct = lobbyInfo.merger_data.current_defunct;
    const survivor = lobbyInfo.merger_data.survivor;
    let newMoney = currentPlayer.money;
    let newStocks = { ...currentPlayer.stocks };
    let availableSurvivor = lobbyInfo.available_stocks[survivor];

    if (action === 'sell') {
      const price = getStockPrice(defunct, lobbyInfo.chain_sizes[defunct]);
      newMoney += count * price;
      newStocks[defunct] -= count;
    } else if (action === 'trade') {
      const tradePairs = Math.floor(count / 2);
      if (availableSurvivor >= tradePairs) {
        newStocks[defunct] -= tradePairs * 2;
        newStocks[survivor] += tradePairs;
        availableSurvivor -= tradePairs;
      }
    }

    const nextDispIndex = (lobbyInfo.disposition_turn_index! + 1) % players.length;
    let nextPhase = 'merger_resolution';

    if (nextDispIndex === lobbyInfo.current_turn_index) {
      const updatedOwnership = { ...lobbyInfo.tile_ownership };
      Object.keys(updatedOwnership).forEach(tile => {
        if (updatedOwnership[tile] === defunct || tile === lobbyInfo.merger_data.tile_placed) {
          updatedOwnership[tile] = survivor;
        }
      });
      nextPhase = 'buy_stocks';
      await supabase.from('lobbies').update({ 
        tile_ownership: updatedOwnership, turn_phase: nextPhase, active_chains: lobbyInfo.active_chains.filter(c => c !== defunct)
      }).eq('id', lobbyInfo.id);
    }

    await supabase.from('players').update({ money: newMoney, stocks: newStocks }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ disposition_turn_index: nextDispIndex, available_stocks: { ...lobbyInfo.available_stocks, [survivor]: availableSurvivor } }).eq('id', lobbyInfo.id);
  };

  const handleEndTurn = async () => {
    const currentPlayer = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || !currentPlayer || currentPlayer.player_name !== playerName) return;
    const newPool = [...lobbyInfo.tile_pool];
    const newHand = [...currentPlayer.hand];
    if (newPool.length > 0) newHand.push(newPool.pop()!);
    setStocksBoughtThisTurn(0); 
    await supabase.from('players').update({ hand: newHand }).eq('id', currentPlayer.id);
    await supabase.from('lobbies').update({ tile_pool: newPool, current_turn_index: (lobbyInfo.current_turn_index + 1) % players.length, turn_phase: 'place_tile' }).eq('id', lobbyInfo.id);
  };

  // --- UI SCREENS (Condensed for brevity) ---
  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: lobbyData } = await supabase.from('lobbies').insert([{ name: `${playerName}'s Game`, join_code: joinCode }]).select().single();
    if (lobbyData) {
      await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: true, money: 6000, hand: [], stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}) }]);
      setIsHost(true); setLobbyInfo(lobbyData);
    }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: lobbyData } = await supabase.from('lobbies').select('*').eq('join_code', joinCodeInput.toUpperCase()).single();
    if (lobbyData) {
      await supabase.from('players').insert([{ lobby_id: lobbyData.id, player_name: playerName, is_host: false, money: 6000, hand: [], stocks: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}) }]);
      setLobbyInfo(lobbyData);
    }
  };

  const handleStartGame = async () => {
    if (!lobbyInfo) return;
    let pool: string[] = [];
    for (let r of BOARD_ROWS) for (let c of BOARD_COLS) pool.push(`${c}${r}`);
    pool = pool.sort(() => Math.random() - 0.5);
    const playersWithStarts = players.map(p => ({ ...p, start: pool.pop()! }));
    playersWithStarts.sort((a, b) => getTileValue(a.start) - getTileValue(b.start));
    const updates = playersWithStarts.map((p, idx) => ({ ...p, starting_tile: p.start, hand: pool.splice(-6), play_order: idx }));
    await supabase.from('players').upsert(updates);
    await supabase.from('lobbies').update({ status: 'playing', board_state: updates.map(u => u.starting_tile), tile_pool: pool, turn_phase: 'place_tile', active_chains: [], chain_sizes: CORPORATIONS.reduce((acc, c) => ({ ...acc, [c]: 0 }), {}), tile_ownership: updates.reduce((acc, u) => ({ ...acc, [u.starting_tile]: null }), {}) }).eq('id', lobbyInfo.id);
  };

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className={`w-full bg-slate-800 rounded-xl shadow-2xl p-8 transition-all ${lobbyInfo?.status === 'playing' ? 'max-w-6xl' : 'max-w-md'}`}>
        <h1 className="text-3xl font-bold text-center mb-8 tracking-wider text-amber-400">ACQUIRE SYNDICATE</h1>

        {!lobbyInfo && view === 'home' && (
          <div className="flex flex-col gap-4">
            <button onClick={() => setView('create')} className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">CREATE LOBBY</button>
            <button onClick={() => setView('join')} className="w-full border-2 border-amber-500 text-amber-500 font-bold py-3 rounded">JOIN LOBBY</button>
          </div>
        )}

        {/* --- Include Create/Join Forms here --- */}
        {!lobbyInfo && view === 'create' && (
          <form onSubmit={handleCreateLobby} className="flex flex-col gap-4">
            <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 p-3 rounded" placeholder="Tycoon Name"/>
            <button type="submit" className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">START</button>
          </form>
        )}

        {!lobbyInfo && view === 'join' && (
          <form onSubmit={handleJoinLobby} className="flex flex-col gap-4">
            <input type="text" maxLength={10} required value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-slate-700 p-3 rounded" placeholder="Tycoon Name"/>
            <input type="text" maxLength={6} required value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="w-full bg-slate-700 p-3 rounded" placeholder="CODE"/>
            <button type="submit" className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded">JOIN</button>
          </form>
        )}

        {lobbyInfo && lobbyInfo.status === 'waiting' && (
          <div className="text-center">
            <p className="text-xl mb-4 text-amber-400">Code: {lobbyInfo.code}</p>
            {isHost && <button onClick={handleStartGame} className="w-full bg-emerald-500 text-white font-bold py-3 rounded">START GAME</button>}
          </div>
        )}

        {lobbyInfo && lobbyInfo.status === 'playing' && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-grow bg-slate-900 p-4 rounded-xl border border-slate-700 overflow-x-auto relative">
              
              {/* TIE BREAKER MODAL */}
              {lobbyInfo.turn_phase === 'merger_resolution' && lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                <div className="absolute inset-0 z-30 bg-slate-900/95 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500 shadow-2xl">
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-amber-400 mb-2">TIE BREAKER!</h2>
                    <p className="text-slate-300 text-sm mb-6">Chains are equal size. Select the chain that will **SURVIVE**.</p>
                    <div className="grid grid-cols-2 gap-3">
                      {lobbyInfo.merger_data.potential_survivors.map((corp: string) => (
                        <button key={corp} onClick={() => handleSelectSurvivor(corp)} className="bg-slate-800 border border-amber-500 p-4 rounded text-white font-bold hover:bg-amber-500 hover:text-black transition-all">
                          {corp}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Founding Modal Overlay (Existing) */}
              {lobbyInfo.turn_phase === 'found_chain' && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                <div className="absolute inset-0 z-20 bg-slate-900/90 flex items-center justify-center p-6 rounded-xl border-4 border-amber-500">
                  <div className="text-center">
                    <h2 className="text-2xl font-bold text-amber-400 mb-6 text-shadow-md">FOUND A HOTEL CHAIN</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {CORPORATIONS.filter(c => !lobbyInfo.active_chains.includes(c)).map(corp => (
                        <button key={corp} onClick={() => handleFoundChain(corp)} className="bg-slate-800 border border-slate-600 p-4 rounded hover:border-amber-500 transition-all font-bold">{corp}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Disposition Modal (Existing) */}
              {lobbyInfo.turn_phase === 'merger_resolution' && !lobbyInfo.merger_data.is_tied && players.find(p => p.play_order === lobbyInfo.disposition_turn_index)?.player_name === playerName && (
                <div className="absolute inset-0 z-20 bg-slate-900/95 flex items-center justify-center p-6 rounded-xl border-4 border-emerald-500">
                  <div className="text-center w-full max-w-sm">
                    <h2 className="text-2xl font-bold text-emerald-400 mb-2">MERGER RESOLUTION</h2>
                    <p className="text-sm text-slate-400 mb-6">{lobbyInfo.merger_data.current_defunct} acquired by {lobbyInfo.merger_data.survivor}</p>
                    <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 mb-6">
                       <p className="text-xs uppercase text-slate-500 mb-1">Your Defunct Shares</p>
                       <p className="text-2xl font-mono text-white">{players.find(p => p.player_name === playerName)?.stocks[lobbyInfo.merger_data.current_defunct] || 0}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                       <button onClick={() => handleDisposition('sell', players.find(p => p.player_name === playerName)?.stocks[lobbyInfo.merger_data.current_defunct] || 0)} className="bg-slate-700 border border-slate-600 p-3 rounded hover:bg-emerald-600 font-bold transition-all">SELL ALL</button>
                       <button onClick={() => handleDisposition('trade', players.find(p => p.player_name === playerName)?.stocks[lobbyInfo.merger_data.current_defunct] || 0)} className="bg-slate-700 border border-slate-600 p-3 rounded hover:bg-amber-600 font-bold transition-all">TRADE ALL (2:1)</button>
                       <button onClick={() => handleDisposition('keep', 0)} className="bg-slate-700 border border-slate-600 p-3 rounded hover:bg-slate-500 font-bold transition-all">KEEP ALL</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="min-w-max grid grid-cols-12 gap-1 sm:gap-2">
                {BOARD_ROWS.map((row) => BOARD_COLS.map((col) => {
                  const tileId = `${col}${row}`;
                  const isPlaced = lobbyInfo.board_state.includes(tileId);
                  const corpOwner = lobbyInfo.tile_ownership[tileId];
                  return (
                    <div key={tileId} className={`w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center rounded text-[10px] sm:text-xs font-bold border-2 transition-colors 
                      ${isPlaced ? (corpOwner ? 'bg-slate-100 text-black' : 'bg-amber-500 text-black border-amber-600') : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                      {tileId}
                    </div>
                  );
                }))}
              </div>
            </div>

            {/* Turn Sidebar (Existing) */}
            <div className="w-full lg:w-80 space-y-4">
               <div className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                  <h3 className="font-bold text-white mb-2">Current Turn: {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name}</h3>
                  {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName ? (
                    lobbyInfo.turn_phase === 'place_tile' ? <p className="text-amber-400">Place a tile.</p> :
                    <div className="space-y-4">
                       <p className="text-emerald-400">Buy Stocks ({stocksBoughtThisTurn}/3)</p>
                       <button onClick={handleEndTurn} className="w-full bg-emerald-600 font-bold py-2 rounded">END TURN</button>
                    </div>
                  ) : <p className="text-slate-400">Waiting...</p>}
               </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
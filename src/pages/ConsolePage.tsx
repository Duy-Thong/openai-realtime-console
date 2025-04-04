/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState, DragEvent } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, Search, RefreshCw } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';

import './ConsolePage.scss';

// Keyword detection instructions
const keywordInstructions = `
Extract keywords in real-time only in English. As soon as a word is spoken, immediately determine if it is a keyword and return it. Do NOT wait for full sentences. Extract and return only nouns, verbs, and critical terms. Exclude articles, prepositions, conjunctions, pronouns, and auxiliary verbs. Return single words, not phrases. Ignore non-English words. Focus on meaningful words relevant to the context. Maintain high accuracy in identifying important terms.`;
// Interface for search results
interface SearchResult {
  content: string;
  loading: boolean;
  tokens?: number;  // Add token count field
}

// Interface for cached search results
interface CachedSearch {
  keyword: string;
  result: SearchResult;
  timestamp: number;
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  // State for search functionality
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult>({
    content: '',
    loading: false
  });
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // Cache for search results
  const [searchCache, setSearchCache] = useState<CachedSearch[]>([]);
  // Add state for drag and drop functionality
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Drag event handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>, keyword: string) => {
    e.dataTransfer.setData('text/plain', keyword);
    e.dataTransfer.effectAllowed = 'copy';
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const keyword = e.dataTransfer.getData('text/plain');
    
    // If there's already text in the search box, add a space before the new keyword
    if (searchKeyword && !searchKeyword.endsWith(' ')) {
      setSearchKeyword(prev => `${prev} ${keyword}`);
    } else {
      setSearchKeyword(prev => `${prev}${keyword}`);
    }
    
    setIsDragging(false);
    
    // Focus the search input after dropping
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };
  // Function to perform search using OpenAI API
  const performSearch = async (keyword: string) => {
    if (!keyword || !apiKey) return;
    
    setSearchKeyword(keyword);
    
    // Check if we have a cached result for this keyword
    const cachedResult = searchCache.find(item => item.keyword.toLowerCase() === keyword.toLowerCase());
    
    if (cachedResult) {
      console.log('Using cached search result for:', keyword);
      setSearchResults(cachedResult.result);
      
      // Update search history if not already present
      if (!searchHistory.includes(keyword)) {
        setSearchHistory(prev => [keyword, ...prev].slice(0, 5));
      }
      
      return;
    }
    
    setSearchResults({ content: '', loading: true });
    
    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                tools: [{
                    type: 'file_search',
                    vector_store_ids: ['vs_67ee03150ce48191bca7e703b889990a'],
                    max_num_results: 20
                }],
                input: keyword,
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        if (data.status !== "completed") {
            throw new Error('Search process is not completed yet');
        }
        
      const messageOutput = data.output.find((output: { type: string; }) => output.type === "message");

      const tokensOutput = data.usage.total_tokens;
      console.log('Tokens used:', tokensOutput);
        let extractedText = "No relevant content found.";
        
        if (messageOutput && messageOutput.content.length > 0) {
            const textContent = messageOutput.content.find((content: { type: string; }) => content.type === "output_text");
            if (textContent) {
                extractedText = textContent.text;
            }
        }
        
        const newResult = {
            content: extractedText,
            loading: false,
            tokens: tokensOutput
        };
        
        setSearchResults(newResult);
        
        // Store in cache
        setSearchCache(prev => {
          // Limit cache size to prevent memory issues (keep last 20 searches)
          const newCache = [...prev, {
            keyword,
            result: newResult,
            timestamp: Date.now()
          }];
          
          // Sort by timestamp (descending) and take the most recent 20
          return newCache.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        });
        
        // Add to search history if not already present
        if (!searchHistory.includes(keyword)) {
            setSearchHistory(prev => [keyword, ...prev].slice(0, 5));
        }
        
    } catch (error) {
        console.error('Search error:', error);
        setSearchResults({
            content: `Error: Failed to search for "${keyword}"`,
            loading: false
        });
    }
};

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - detectedKeywords stores keywords recognized from speech
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [detectedKeywords, setDetectedKeywords] = useState<string[]>([]);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    // Set state variables
    setIsConnected(true);
    setItems([]);
    setDetectedKeywords([]);

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to realtime API
    await client.connect();
    

    if (client.getTurnDetectionType() === 'server_vad') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setItems([]);
    setDetectedKeywords([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, events and more
   */
  useEffect(() => {
    // Get refs
    const client = clientRef.current;

    // Set instructions for keyword detection
    client.updateSession({ instructions: keywordInstructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' },modalities: ['text'] });

    // Add debug event handler to see all events
    client.on('realtime.event', (event: any) => {
      console.log('Realtime event:', event);
    });

    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      console.log('Conversation item updated:', item);
      
      // Check for transcription in user items
      if (item.role === 'user' && item.formatted.transcript) {
        console.log('User transcript:', item.formatted.transcript);
      }
      
      // Check for keywords in assistant responses
      if (item.role === 'assistant' && item.formatted.text) {
        const text = item.formatted.text.trim();
        console.log('Assistant response:', text);
        
        if (text && text !== "No keywords detected.") {
          // Improved approach to extract keywords while preserving compound words
          // First, try to extract full phrases separated by commas or new lines
          let potentialKeywords: string[] = [];
          
          // Try to split by commas or newlines first to preserve multi-word phrases
          potentialKeywords = text
            .split(/[,\n]+/)
            .map((phrase: string) => phrase.trim())
            .filter((phrase: string) => 
              phrase.length > 0 && 
              !phrase.includes('KEYWORD:') && 
              phrase !== 'No' && 
              phrase !== 'keywords' && 
              phrase !== 'detected.'
            );
          
          // If no obvious phrases were found (no commas or newlines), 
          // then we might need to take the whole text as a single keyword
          if (potentialKeywords.length === 0 && text.length > 0) {
            // Remove any KEYWORD: prefix if it exists
            const cleanedText = text.replace(/^KEYWORD:\s*/i, '');
            if (cleanedText !== 'No keywords detected.') {
              potentialKeywords = [cleanedText];
            }
          }
          
          if (potentialKeywords.length > 0) {
            console.log('Detected keywords:', potentialKeywords);
            // Only add keywords that aren't already in the array
            setDetectedKeywords(prev => {
              const uniqueKeywords = potentialKeywords.filter(
                (keyword: string) => !prev.includes(keyword)
              );
              return [...prev, ...uniqueKeywords];
            });
          }
        }
      }
      
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);


  /**
   * Render the simplified application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/openai-logomark.svg" />
          <span>voice keyword detector</span>
        </div>
        <div className="content-api-key">
          {!LOCAL_RELAY_SERVER_URL && (
            <Button
              icon={Edit}
              iconPosition="end"
              buttonStyle="flush"
              label={`api key: ${apiKey.slice(0, 3)}...`}
              onClick={() => resetAPIKey()}
            />
          )}
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          {/* Visualization moved down to give priority to keywords and transcript */}
          <div className="content-block keywords-display">
            <div className="content-block-title">DETECTED KEYWORDS</div>
            <div className="content-block-body keywords-container" data-conversation-content>
              {detectedKeywords.length === 0 ? (
                <div className="no-keywords">Speak to detect keywords</div>
              ) : (
                <div className="keywords-grid">
                  {detectedKeywords.map((keyword, index) => (
                    <div 
                      key={index} 
                      className={`keyword-badge ${isDragging ? 'draggable' : ''}`}
                      onClick={() => performSearch(keyword)}
                      title="Click to search or drag to combine with other keywords"
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, keyword)}
                      onDragEnd={handleDragEnd}
                    >
                      {keyword}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Transcript section with improved visibility */}
          <div className="content-block conversation transcript-section">
            <div className="content-block-title">LIVE TRANSCRIPT</div>
            <div className="content-block-body transcript-container" data-conversation-content>
              {items.length === 0 ? (
                <div className="no-transcripts">No speech detected yet</div>
              ) : (
                <div className="transcripts-list">
                  {items.map((item, index) => (
                    <div key={index} className={`transcript-item ${item.role}`}>
                      <div className="transcript-role">{item.role === 'user' ? 'You' : 'AI'}</div>
                      <div className="transcript-text">
                        {item.formatted.transcript || item.formatted.text || "(no text)"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Visualization moved here */}
          <div className="content-block visualization">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
            </div>
            <div className="content-block-title">VOICE INPUT</div>
          </div>
          
          <div className="content-actions">
            <Toggle
              defaultValue={false}
              labels={['manual', 'vad']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
            <div className="spacer" />
            {isConnected && canPushToTalk && (
              <Button
                label={isRecording ? 'release to send' : 'push to talk'}
                buttonStyle={isRecording ? 'alert' : 'regular'}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
              />
            )}
            <div className="spacer" />
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
            />
          </div>
        </div>
        
        {/* New search panel on the right */}
        <div className="search-panel">
          <div className="search-header">
            
            <div 
              className={`search-box ${isDragging ? 'drop-target' : ''}`}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input 
                ref={searchInputRef}
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="Enter keyword or drag keywords here"
              />
              <Button
                icon={Search}
                buttonStyle="action"
                disabled={!searchKeyword || searchResults.loading}
                onClick={() => performSearch(searchKeyword)}
              />
            </div>
            <div className="search-history">
              <div className="history-title">
                Recent Searches:
                {searchCache.length > 0 && (
                  <span className="cache-status" title="Using cached results">
                    ({searchCache.length} cached)
                  </span>
                )}
              </div>
              <div className="history-items">
                {searchHistory.map((term, idx) => (
                  <Button 
                    key={idx}
                    label={term}
                    buttonStyle="flush"
                    onClick={() => {
                      setSearchKeyword(term);
                      performSearch(term);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          
          <div className="search-results">
            <div className="results-header">
              <div className="results-title">
                {searchKeyword ? `Results for "${searchKeyword}"` : "No search performed"}
                {searchResults.loading && (
                  <RefreshCw className="loading-icon" />
                )}
              </div>
            </div>
            <div className="results-content">
              {searchResults.content ? (
                <div className="result-text">
                  {searchResults.content}
                  {searchResults.tokens && (
                    <div className="token-count">
                      <p>Total tokens used: {searchResults.tokens}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-results">
                  {searchResults.loading ? "Searching..." : "No results yet. Click on a keyword or use the search box above."}
                </div>
              )}
              <p></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

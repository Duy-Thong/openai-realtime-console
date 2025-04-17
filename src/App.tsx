import { ConsolePage } from './pages/ConsolePage';
import { WebRtcPage } from './pages/WebRtcPage';
import { useState } from 'react';
import './App.scss';
import { Button } from './components/button/Button';

function App() {
  const [currentPage, setCurrentPage] = useState<'console' | 'webrtc'>('webrtc');

  return (
    <div data-component="App">
      <div className="app-navigation">
        <Button 
          label="Console Page" 
          buttonStyle={currentPage === 'console' ? 'action' : 'regular'}
          onClick={() => setCurrentPage('console')}
        />
        <Button 
          label="WebRTC Demo" 
          buttonStyle={currentPage === 'webrtc' ? 'action' : 'regular'}
          onClick={() => setCurrentPage('webrtc')}
        />
      </div>
      
      {currentPage === 'console' ? <ConsolePage /> : <WebRtcPage />}
    </div>
  );
}

export default App;

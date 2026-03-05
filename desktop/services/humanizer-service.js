/**
 * Simulates human-like typing into a DOM element.
 * Uses multiple input strategies to ensure Facebook's React E2EE chat registers the text.
 * @param {HTMLElement} element 
 * @param {string} text 
 */
async function typeHumanLike(element, text) {
    element.focus();
    element.click();
    await new Promise(r => setTimeout(r, 100));
    
    // Strategy 1: Try execCommand with individual characters + proper events
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // Dispatch beforeinput (React 16+ listens for this)
        element.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: char, composed: true
        }));
        
        // Dispatch keydown
        element.dispatchEvent(new KeyboardEvent('keydown', {
            key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0), bubbles: true, composed: true
        }));
        
        // Insert text via execCommand
        document.execCommand('insertText', false, char);
        
        // Dispatch input event for React to pick up changes
        element.dispatchEvent(new InputEvent('input', {
            bubbles: true, inputType: 'insertText', data: char, composed: true
        }));
        
        // Dispatch keyup
        element.dispatchEvent(new KeyboardEvent('keyup', {
            key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0), bubbles: true, composed: true
        }));
        
        // Random delay (50ms - 150ms)
        const delay = Math.floor(Math.random() * 100) + 50; 
        await new Promise(r => setTimeout(r, delay));
    }
    
    // Verify text was inserted; if textbox is empty, try clipboard fallback
    const currentText = (element.textContent || '').trim();
    if (currentText.length === 0 && text.length > 0) {
        console.warn('[Humanizer] execCommand failed, trying clipboard paste fallback...');
        try {
            // Focus and select all existing content
            element.focus();
            
            // Use DataTransfer to simulate paste
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true, cancelable: true, clipboardData: dataTransfer, composed: true
            });
            element.dispatchEvent(pasteEvent);
            
            // Also dispatch input event after paste
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertFromPaste', data: text, composed: true
            }));
            
            await new Promise(r => setTimeout(r, 200));
        } catch (pasteErr) {
            console.error('[Humanizer] Clipboard paste fallback failed:', pasteErr);
        }
    }
}

module.exports = { typeHumanLike };

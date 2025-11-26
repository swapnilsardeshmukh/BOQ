BOQ GPT Full Working Package
=============================

This package includes a full working Node.js server with:
- Local deterministic BOQ engine (boqEngine.js)
- GPT integration endpoint (/api/analyze_gpt) which requires OPENAI_API_KEY
- UI to enter prompt, view materials/work/misc, and download Excel
- Masters folder copied from /mnt/data (if available)
- Protected master upload endpoint (requires MASTER_KEY)

How to run:
1. Extract ZIP and open terminal in the folder.
2. Install dependencies: npm install
3. Set env vars:
   export OPENAI_API_KEY="sk-..."
   export MASTER_KEY="your_master_key"
4. Start server: node server.js
5. Open: http://localhost:3456

Notes:
- The GPT endpoint sends a small preview of masters to the model to help it use correct codes.
- Model set to gpt-5.1-mini; change in server.js if needed.

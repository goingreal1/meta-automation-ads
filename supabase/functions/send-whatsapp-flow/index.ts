Deno.serve(()=>new Response(JSON.stringify({
    error: "gone"
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  }));

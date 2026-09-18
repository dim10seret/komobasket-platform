"use client";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

export type PlatformApi = {
  namespace: "admin" | "user";
  canManage: boolean;
  request: typeof fetch;
  url: (path: string) => string;
};
const adminApi: PlatformApi = {
  namespace: "admin", canManage: true,
  request: (input, init) => globalThis.fetch(input, init),
  url: (path) => path,
};
const Context=createContext<PlatformApi>(adminApi);
export const usePlatformContext=()=>useContext(Context);
export function PlatformProvider({value,children}:{value:PlatformApi;children:ReactNode}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function createUserPlatformApi(organizationId: string, role: "admin"|"viewer", csrf: string): PlatformApi {
  const url=(path:string)=>{
    if(!path.startsWith("/api/admin/"))throw new Error("Unsupported Platform API path");
    const parsed=new URL(path,"https://platform.invalid");
    parsed.pathname=parsed.pathname.replace("/api/admin/","/api/user/platform/");
    parsed.searchParams.set("organizationId",organizationId);
    return parsed.pathname+parsed.search;
  };
  const request:typeof fetch=async(input,init={})=>{
    if(typeof input!=="string")throw new Error("Platform requests must use an explicit local path");
    let target=url(input);
    let options={...init};
    let method=(options.method || "GET").toUpperCase();
    if(method==="PATCH" && typeof options.body==="string" && input.split("?")[0]==="/api/admin/league") {
      const body=JSON.parse(options.body) as Record<string,unknown>;
      if(body.action==="searchAthletes" || body.action==="searchStaff") {
        const parsed=new URL(target,"https://platform.invalid");
        parsed.searchParams.set("view",String(body.action));
        parsed.searchParams.set("query",String(body.query || ""));
        target=parsed.pathname+parsed.search;options={...options,method:"GET",body:undefined};method="GET";
      }
    }
    const headers=new Headers(options.headers);
    if(method!=="GET") {
      if(role!=="admin" || !csrf)return Response.json({error:"Έχετε πρόσβαση μόνο για προβολή."},{status:403});
      headers.set("X-Kb-User-Csrf",csrf);
      if(options.body instanceof FormData) {
        const body=new FormData();
        for(const [key,value] of options.body)body.append(key,value);
        body.set("organizationId",organizationId);options.body=body;
      } else if(typeof options.body==="string") {
        options.body=JSON.stringify({...JSON.parse(options.body),organizationId});
      }
    }
    const response=await globalThis.fetch(target,{...options,headers,credentials:"same-origin",cache:"no-store"});
    if(response.status===401 && typeof window!=="undefined")window.location.assign("/user");
    return response;
  };
  return {namespace:"user",canManage:role==="admin",url,request};
}
export function PlatformButton({mutation=false,disabled,...props}:ComponentProps<"button">&{mutation?:boolean}) {
  const {canManage}=usePlatformContext();
  return <button {...props} disabled={disabled || (mutation && !canManage)} />;
}
export function PlatformForm({children,onSubmit,readOnlyAction=false,...props}:ComponentProps<"form">&{readOnlyAction?:boolean}) {
  const {canManage}=usePlatformContext();
  if(canManage || readOnlyAction)return <form {...props} onSubmit={onSubmit}>{children}</form>;
  return <form {...props} onSubmit={(event)=>event.preventDefault()}><fieldset disabled className="contents">{children}</fieldset></form>;
}
export function PlatformFileInput(props:ComponentProps<"input">) {
  const {canManage}=usePlatformContext();
  return <input {...props} disabled={props.disabled || !canManage} />;
}

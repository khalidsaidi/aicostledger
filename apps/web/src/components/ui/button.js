import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-60", {
    variants: {
        variant: {
            default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
            outline: "border border-border bg-transparent text-foreground hover:bg-muted",
            ghost: "text-foreground hover:bg-muted",
            accent: "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90",
            destructive: "bg-red-600 text-white shadow-sm hover:bg-red-500"
        },
        size: {
            sm: "h-9 px-4",
            md: "h-11 px-6",
            lg: "h-12 px-7 text-base"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (_jsx(Comp, { className: cn(buttonVariants({ variant, size, className })), ref: ref, ...props }));
});
Button.displayName = "Button";
export { Button, buttonVariants };

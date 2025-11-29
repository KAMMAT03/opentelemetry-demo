// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
using System.Diagnostics;
using System.Threading.Tasks;
using System;
using System.Collections.Generic;
using System.Threading;
using Grpc.Core;
using cart.cartstore;
using OpenFeature;
using Oteldemo;

namespace cart.services;

public class CartService : Oteldemo.CartService.CartServiceBase
{
    private static readonly Empty Empty = new();
    private readonly Random random = new Random();
    private readonly ICartStore _badCartStore;
    private readonly ICartStore _cartStore;
    private readonly IFeatureClient _featureFlagHelper;

    public CartService(ICartStore cartStore, ICartStore badCartStore, IFeatureClient featureFlagService)
    {
        _badCartStore = badCartStore;
        _cartStore = cartStore;
        _featureFlagHelper = featureFlagService;
    }

    public override async Task<Empty> AddItem(AddItemRequest request, ServerCallContext context)
    {
        var activity = Activity.Current;
        activity?.SetTag("app.user.id", request.UserId);
        activity?.SetTag("app.product.id", request.Item.ProductId);
        activity?.SetTag("app.product.quantity", request.Item.Quantity);

        try
        {
            await _cartStore.AddItemAsync(request.UserId, request.Item.ProductId, request.Item.Quantity);

            return Empty;
        }
        catch (RpcException ex)
        {
            activity?.AddException(ex);
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        }
    }

    public override async Task<Cart> GetCart(GetCartRequest request, ServerCallContext context)
    {
        var activity = Activity.Current;
        activity?.SetTag("app.user.id", request.UserId);
        activity?.AddEvent(new("Fetch cart"));

        try
        {
            var cart = await _cartStore.GetCartAsync(request.UserId);
            var totalCart = 0;

            // Check if thesis inefficient data structure bug is enabled
            var bugEnabled = await _featureFlagHelper.GetBooleanValueAsync("thesisInefficientDataStructure", false);
            activity?.SetTag("thesis.bug.enabled", bugEnabled);

            if (bugEnabled)
            {
                // THESIS BUG: Inefficient data structure - using O(n²) nested loops instead of O(1) Dictionary lookup
                // This simulates using List.Contains() in nested loops instead of HashSet/Dictionary
                activity?.SetTag("code.function", "GetCart");
                activity?.SetTag("code.filepath", "src/cart/src/services/CartService.cs");
                activity?.SetTag("code.namespace", "cart.services");
                activity?.SetTag("thesis.bug.type", "inefficient_data_structure");
                activity?.AddEvent(new("thesis_bug_triggered: inefficient_data_structure"));

                // Create a list of product IDs (simulating inefficient data structure)
                var productIdList = new List<string>();
                foreach (var item in cart.Items)
                {
                    productIdList.Add(item.ProductId);
                }

                // O(n²) operation: for each item, search through the list multiple times
                foreach (var item in cart.Items)
                {
                    totalCart += item.Quantity;

                    // Inefficient: Linear search through list multiple times per item
                    for (int i = 0; i < productIdList.Count; i++)
                    {
                        // Simulate expensive comparison with small delay
                        if (productIdList[i] == item.ProductId)
                        {
                            Thread.Sleep(10); // Small delay to simulate expensive lookup
                        }
                    }

                    // Additional inefficient nested loop
                    foreach (var otherId in productIdList)
                    {
                        if (otherId.Contains(item.ProductId.Substring(0, Math.Min(3, item.ProductId.Length))))
                        {
                            Thread.Sleep(5); // Another small delay
                        }
                    }
                }
            }
            else
            {
                foreach (var item in cart.Items)
                {
                    totalCart += item.Quantity;
                }
            }

            activity?.SetTag("app.cart.items.count", totalCart);

            return cart;
        }
        catch (RpcException ex)
        {
            activity?.AddException(ex);
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        }
    }

    public override async Task<Empty> EmptyCart(EmptyCartRequest request, ServerCallContext context)
    {
        var activity = Activity.Current;
        activity?.SetTag("app.user.id", request.UserId);
        activity?.AddEvent(new("Empty cart"));

        try
        {
            if (await _featureFlagHelper.GetBooleanValueAsync("cartFailure", false))
            {
                await _badCartStore.EmptyCartAsync(request.UserId);
            }
            else
            {
                await _cartStore.EmptyCartAsync(request.UserId);
            }
        }
        catch (RpcException ex)
        {
            Activity.Current?.AddException(ex);
            Activity.Current?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        }

        return Empty;
    }
}

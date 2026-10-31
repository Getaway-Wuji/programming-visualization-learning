#include <iostream>
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase buckets
    int bucketData[150];
    int bucketSizes[5] = {};
    // @phase scatter
    for (int i = 0; i < n; i = i + 1) {
        int bucket = (values[i] + 20) / 10;
        int slot = bucket * 30 + bucketSizes[bucket];
        bucketData[slot] = values[i];
        bucketSizes[bucket] = bucketSizes[bucket] + 1;
    }
    // @phase sort
    for (int bucket = 0; bucket < 5; bucket = bucket + 1) {
        int base = bucket * 30;
        for (int i = 1; i < bucketSizes[bucket]; i = i + 1) {
            int key = bucketData[base + i];
            int j = i - 1;
            // @phase shift
            while (j >= 0 && bucketData[base + j] > key) {
                bucketData[base + j + 1] = bucketData[base + j];
                j = j - 1;
            }
            // @phase place
            bucketData[base + j + 1] = key;
        }
    }
    // @phase merge
    int at = 0;
    for (int bucket = 0; bucket < 5; bucket = bucket + 1) {
        for (int i = 0; i < bucketSizes[bucket]; i = i + 1) {
            values[at] = bucketData[bucket * 30 + i];
            at = at + 1;
        }
    }
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
